import json
import os
import base64
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database import get_db, Funcionario
from routers.auth import get_admin_atual
from services.facial import gerar_encoding, base64_para_imagem_bgr as base64_para_imagem
from PIL import Image
import io
import numpy as np

router = APIRouter(prefix="/api/funcionarios", tags=["funcionarios"])

FOTOS_DIR = "fotos_funcionarios"


class FuncionarioUpdate(BaseModel):
    nome: Optional[str] = None
    cargo: Optional[str] = None
    departamento: Optional[str] = None
    email: Optional[str] = None
    ativo: Optional[bool] = None


def salvar_foto(funcionario_id: int, imagem_bytes: bytes) -> str:
    """Salva a foto do funcionário e retorna o caminho."""
    os.makedirs(FOTOS_DIR, exist_ok=True)
    caminho = f"{FOTOS_DIR}/{funcionario_id}.jpg"
    img = Image.open(io.BytesIO(imagem_bytes)).convert("RGB")
    img = img.resize((300, 300), Image.Resampling.LANCZOS)
    img.save(caminho, "JPEG", quality=85)
    return caminho


def funcionario_para_dict(f: Funcionario) -> dict:
    foto_base64 = None
    if f.foto_path and os.path.exists(f.foto_path):
        with open(f.foto_path, "rb") as arq:
            foto_base64 = "data:image/jpeg;base64," + base64.b64encode(arq.read()).decode()
    return {
        "id": f.id,
        "nome": f.nome,
        "cpf": f.cpf,
        "cargo": f.cargo,
        "departamento": f.departamento,
        "email": f.email,
        "ativo": f.ativo,
        "foto_path": f.foto_path,
        "foto_base64": foto_base64,
        "tem_encoding": f.encoding_facial is not None,
        "data_cadastro": f.data_cadastro.strftime("%d/%m/%Y %H:%M") if f.data_cadastro else None
    }


@router.get("")
def listar_funcionarios(
    db: Session = Depends(get_db),
    admin=Depends(get_admin_atual)
):
    funcionarios = db.query(Funcionario).order_by(Funcionario.nome).all()
    return [funcionario_para_dict(f) for f in funcionarios]


@router.post("")
async def cadastrar_funcionario(
    nome: str = Form(...),
    cpf: str = Form(...),
    cargo: str = Form(...),
    departamento: str = Form(...),
    email: str = Form(""),
    foto: Optional[UploadFile] = File(None),
    foto_base64: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    admin=Depends(get_admin_atual)
):
    # Verifica CPF duplicado
    cpf_limpo = cpf.replace(".", "").replace("-", "")
    existente = db.query(Funcionario).filter(Funcionario.cpf == cpf_limpo).first()
    if existente:
        raise HTTPException(status_code=400, detail="CPF já cadastrado no sistema")

    novo = Funcionario(
        nome=nome,
        cpf=cpf_limpo,
        cargo=cargo,
        departamento=departamento,
        email=email,
        ativo=True,
        data_cadastro=datetime.now()
    )
    db.add(novo)
    db.flush()  # Obtém o ID sem commitar

    # Processa foto
    imagem_bytes = None
    if foto and foto.filename:
        imagem_bytes = await foto.read()
    elif foto_base64:
        if "," in foto_base64:
            foto_base64 = foto_base64.split(",")[1]
        imagem_bytes = base64.b64decode(foto_base64)

    if imagem_bytes:
        try:
            caminho = salvar_foto(novo.id, imagem_bytes)
            novo.foto_path = caminho
            # Gera encoding facial
            b64_str = base64.b64encode(imagem_bytes).decode()
            encoding = gerar_encoding(b64_str)
            novo.encoding_facial = json.dumps(encoding)
        except ValueError as e:
            # Foto salva mas sem encoding
            novo.foto_path = salvar_foto(novo.id, imagem_bytes)

    db.commit()
    db.refresh(novo)
    return {
        "sucesso": True,
        "mensagem": f"Funcionário {novo.nome} cadastrado com sucesso!",
        "funcionario": funcionario_para_dict(novo)
    }


@router.put("/{funcionario_id}")
def atualizar_funcionario(
    funcionario_id: int,
    dados: FuncionarioUpdate,
    db: Session = Depends(get_db),
    admin=Depends(get_admin_atual)
):
    func = db.query(Funcionario).filter(Funcionario.id == funcionario_id).first()
    if not func:
        raise HTTPException(status_code=404, detail="Funcionário não encontrado")

    if dados.nome is not None:
        func.nome = dados.nome
    if dados.cargo is not None:
        func.cargo = dados.cargo
    if dados.departamento is not None:
        func.departamento = dados.departamento
    if dados.email is not None:
        func.email = dados.email
    if dados.ativo is not None:
        func.ativo = dados.ativo

    db.commit()
    db.refresh(func)
    return {"sucesso": True, "funcionario": funcionario_para_dict(func)}


@router.delete("/{funcionario_id}")
def desativar_funcionario(
    funcionario_id: int,
    db: Session = Depends(get_db),
    admin=Depends(get_admin_atual)
):
    func = db.query(Funcionario).filter(Funcionario.id == funcionario_id).first()
    if not func:
        raise HTTPException(status_code=404, detail="Funcionário não encontrado")
    func.ativo = not func.ativo
    db.commit()
    status_str = "ativado" if func.ativo else "desativado"
    return {"sucesso": True, "mensagem": f"Funcionário {status_str} com sucesso"}


@router.post("/{funcionario_id}/foto")
async def atualizar_foto(
    funcionario_id: int,
    foto: Optional[UploadFile] = File(None),
    foto_base64: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    admin=Depends(get_admin_atual)
):
    func = db.query(Funcionario).filter(Funcionario.id == funcionario_id).first()
    if not func:
        raise HTTPException(status_code=404, detail="Funcionário não encontrado")

    imagem_bytes = None
    if foto and foto.filename:
        imagem_bytes = await foto.read()
    elif foto_base64:
        if "," in foto_base64:
            foto_base64 = foto_base64.split(",")[1]
        imagem_bytes = base64.b64decode(foto_base64)

    if not imagem_bytes:
        raise HTTPException(status_code=400, detail="Nenhuma imagem fornecida")

    try:
        caminho = salvar_foto(func.id, imagem_bytes)
        func.foto_path = caminho
        b64_str = base64.b64encode(imagem_bytes).decode()
        encoding = gerar_encoding(b64_str)
        func.encoding_facial = json.dumps(encoding)
        db.commit()
        return {"sucesso": True, "mensagem": "Foto e reconhecimento facial atualizados com sucesso!"}
    except ValueError as e:
        db.commit()
        raise HTTPException(status_code=400, detail=str(e))
