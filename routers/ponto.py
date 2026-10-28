import base64
import json
import os
from datetime import datetime, date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database import get_db, Funcionario, RegistroPonto
from services.facial import verificar_face

router = APIRouter(prefix="/api/ponto", tags=["ponto"])

FOTOS_REGISTROS_DIR = "fotos_registros"

TIPOS_VALIDOS = {
    "entrada": "Entrada",
    "almoco_saida": "Saída para Almoço",
    "almoco_retorno": "Retorno do Almoço",
    "saida": "Saída"
}


class RegistroRequest(BaseModel):
    imagem_base64: str
    tipo: str


def salvar_foto_registro(imagem_base64: str, funcionario_id: int, tipo: str) -> Optional[str]:
    """Salva foto do registro de ponto."""
    try:
        os.makedirs(FOTOS_REGISTROS_DIR, exist_ok=True)
        if "," in imagem_base64:
            imagem_base64 = imagem_base64.split(",")[1]
        dados = base64.b64decode(imagem_base64)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        caminho = f"{FOTOS_REGISTROS_DIR}/{funcionario_id}_{tipo}_{timestamp}.jpg"
        with open(caminho, "wb") as f:
            f.write(dados)
        return caminho
    except Exception:
        return None


def get_foto_base64(foto_path: str) -> Optional[str]:
    if foto_path and os.path.exists(foto_path):
        with open(foto_path, "rb") as f:
            return "data:image/jpeg;base64," + base64.b64encode(f.read()).decode()
    return None


@router.post("/registrar")
def registrar_ponto(dados: RegistroRequest, db: Session = Depends(get_db)):
    if dados.tipo not in TIPOS_VALIDOS:
        raise HTTPException(status_code=400, detail=f"Tipo inválido. Use: {', '.join(TIPOS_VALIDOS.keys())}")

    # Busca todos funcionários ativos com encoding facial
    funcionarios = db.query(Funcionario).filter(
        Funcionario.ativo == True,
        Funcionario.encoding_facial.isnot(None)
    ).all()

    if not funcionarios:
        raise HTTPException(
            status_code=503,
            detail="Nenhum funcionário cadastrado com reconhecimento facial. Contate o administrador."
        )

    lista_encodings = [
        {"id": f.id, "nome": f.nome, "encoding_facial": f.encoding_facial}
        for f in funcionarios
    ]

    resultado = verificar_face(dados.imagem_base64, lista_encodings)

    if "erro" in resultado:
        return {
            "sucesso": False,
            "mensagem": resultado["erro"],
            "tipo": TIPOS_VALIDOS.get(dados.tipo, dados.tipo)
        }

    funcionario_id = resultado["funcionario_id"]
    func = db.query(Funcionario).filter(Funcionario.id == funcionario_id).first()

    # Verifica se já registrou este tipo hoje
    hoje_inicio = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    registro_existente = db.query(RegistroPonto).filter(
        RegistroPonto.funcionario_id == funcionario_id,
        RegistroPonto.tipo == dados.tipo,
        RegistroPonto.timestamp >= hoje_inicio
    ).first()

    if registro_existente:
        hora_registro = registro_existente.timestamp.strftime("%H:%M")
        return {
            "sucesso": False,
            "mensagem": f"{func.nome} já registrou '{TIPOS_VALIDOS[dados.tipo]}' hoje às {hora_registro}.",
            "tipo": TIPOS_VALIDOS.get(dados.tipo, dados.tipo)
        }

    # Salva foto do registro
    foto_caminho = salvar_foto_registro(dados.imagem_base64, funcionario_id, dados.tipo)

    # Cria registro
    registro = RegistroPonto(
        funcionario_id=funcionario_id,
        tipo=dados.tipo,
        timestamp=datetime.now(),
        foto_registro=foto_caminho,
        confianca=resultado["confianca"]
    )
    db.add(registro)
    db.commit()
    db.refresh(registro)

    foto_funcionario = get_foto_base64(func.foto_path)

    return {
        "sucesso": True,
        "funcionario_id": func.id,
        "funcionario_nome": func.nome,
        "cargo": func.cargo,
        "departamento": func.departamento,
        "tipo": dados.tipo,
        "tipo_label": TIPOS_VALIDOS[dados.tipo],
        "timestamp": registro.timestamp.strftime("%d/%m/%Y %H:%M:%S"),
        "confianca": resultado["confianca"],
        "foto_base64": foto_funcionario,
        "mensagem": f"Ponto registrado com sucesso! Olá, {func.nome}!"
    }


@router.get("/ultimos")
def ultimos_registros(db: Session = Depends(get_db)):
    registros = db.query(RegistroPonto).order_by(
        RegistroPonto.timestamp.desc()
    ).limit(20).all()

    resultado = []
    for r in registros:
        func = r.funcionario
        resultado.append({
            "id": r.id,
            "funcionario_nome": func.nome if func else "Desconhecido",
            "cargo": func.cargo if func else "",
            "tipo": r.tipo,
            "tipo_label": TIPOS_VALIDOS.get(r.tipo, r.tipo),
            "timestamp": r.timestamp.strftime("%d/%m/%Y %H:%M:%S"),
            "confianca": r.confianca,
            "foto_base64": get_foto_base64(func.foto_path) if func else None
        })
    return resultado


@router.get("/funcionario/{funcionario_id}/hoje")
def registros_hoje(funcionario_id: int, db: Session = Depends(get_db)):
    hoje_inicio = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    registros = db.query(RegistroPonto).filter(
        RegistroPonto.funcionario_id == funcionario_id,
        RegistroPonto.timestamp >= hoje_inicio
    ).order_by(RegistroPonto.timestamp).all()

    return [
        {
            "tipo": r.tipo,
            "tipo_label": TIPOS_VALIDOS.get(r.tipo, r.tipo),
            "timestamp": r.timestamp.strftime("%H:%M:%S")
        }
        for r in registros
    ]


@router.get("/stats/hoje")
def estatisticas_hoje(db: Session = Depends(get_db)):
    hoje_inicio = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

    total_funcionarios = db.query(Funcionario).filter(Funcionario.ativo == True).count()

    presentes_hoje = db.query(RegistroPonto.funcionario_id).filter(
        RegistroPonto.tipo == "entrada",
        RegistroPonto.timestamp >= hoje_inicio
    ).distinct().count()

    total_registros_hoje = db.query(RegistroPonto).filter(
        RegistroPonto.timestamp >= hoje_inicio
    ).count()

    return {
        "total_funcionarios": total_funcionarios,
        "presentes_hoje": presentes_hoje,
        "ausentes_hoje": max(0, total_funcionarios - presentes_hoje),
        "total_registros_hoje": total_registros_hoje
    }
