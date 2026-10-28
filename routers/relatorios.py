import csv
import io
import calendar
from datetime import datetime, date, timedelta
from typing import Optional
from collections import defaultdict

from fastapi import APIRouter, Depends, Query, HTTPException, Body
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database import get_db, Funcionario, RegistroPonto, AjustePonto
from routers.auth import get_admin_atual

router = APIRouter(prefix="/api/relatorios", tags=["relatorios"])

TIPOS_LABEL = {
    "entrada": "Entrada",
    "almoco_saida": "Saída Almoço",
    "almoco_retorno": "Retorno Almoço",
    "saida": "Saída"
}


class SalvarAjusteRequest(BaseModel):
    funcionario_id: int
    data: str  # DD/MM/YYYY ou YYYY-MM-DD
    tipo_ajuste: str  # "manual", "atestado", "falta_justificada"
    motivo: Optional[str] = ""
    entrada: Optional[str] = None
    almoco_saida: Optional[str] = None
    almoco_retorno: Optional[str] = None
    saida: Optional[str] = None


def converter_data_iso(data_str: str) -> str:
    """Converte DD/MM/YYYY para YYYY-MM-DD se necessário."""
    if "/" in data_str:
        partes = data_str.split("/")
        if len(partes) == 3:
            return f"{partes[2]}-{partes[1].zfill(2)}-{partes[0].zfill(2)}"
    return data_str


def calcular_horas_str(entrada: str, saida_almoco: str, retorno_almoco: str, saida: str) -> str:
    """Calcula horas trabalhadas a partir dos textos de horário HH:MM."""
    def parse_min(horario: str):
        if not horario or ":" not in horario or "FALTA" in horario or "Sem" in horario:
            return None
        try:
            h, m = map(int, horario.split(":")[:2])
            return h * 60 + m
        except Exception:
            return None

    min_ent = parse_min(entrada)
    min_sai = parse_min(saida)
    if min_ent is None:
        return "0h 0min"
    
    if min_sai is None:
        return "-"

    total = min_sai - min_ent
    min_alm_s = parse_min(saida_almoco)
    min_alm_r = parse_min(retorno_almoco)
    if min_alm_s is not None and min_alm_r is not None:
        total -= (min_alm_r - min_alm_s)

    if total < 0:
        total = 0

    return f"{total // 60}h {total % 60}min"


def extrair_linhas_periodo(db: Session, ano: int, mes: int, funcionario_id: Optional[int] = None):
    inicio = datetime(ano, mes, 1)
    dias_no_mes = calendar.monthrange(ano, mes)[1]
    if mes == 12:
        fim = datetime(ano + 1, 1, 1)
    else:
        fim = datetime(ano, mes + 1, 1)

    hoje = datetime.now().date()

    query_func = db.query(Funcionario)
    if funcionario_id:
        query_func = query_func.filter(Funcionario.id == funcionario_id)
    else:
        query_func = query_func.filter(Funcionario.ativo == True)
    funcionarios = query_func.order_by(Funcionario.nome).all()

    # Busca batidas reais
    query_reg = db.query(RegistroPonto).filter(
        RegistroPonto.timestamp >= inicio,
        RegistroPonto.timestamp < fim
    )
    if funcionario_id:
        query_reg = query_reg.filter(RegistroPonto.funcionario_id == funcionario_id)
    registros = query_reg.order_by(RegistroPonto.timestamp).all()

    por_func_dia = defaultdict(lambda: defaultdict(list))
    for r in registros:
        dia = r.timestamp.date()
        por_func_dia[r.funcionario_id][dia].append({
            "tipo": r.tipo,
            "timestamp_str": r.timestamp.strftime("%H:%M")
        })

    # Busca ajustes/atestados manuais salvos pelo admin
    inicio_iso = inicio.strftime("%Y-%m-%d")
    fim_iso = (fim - timedelta(days=1)).strftime("%Y-%m-%d")
    query_ajustes = db.query(AjustePonto).filter(
        AjustePonto.data >= inicio_iso,
        AjustePonto.data <= fim_iso
    )
    if funcionario_id:
        query_ajustes = query_ajustes.filter(AjustePonto.funcionario_id == funcionario_id)
    ajustes = query_ajustes.all()

    ajustes_dict = {}
    for a in ajustes:
        ajustes_dict[(a.funcionario_id, a.data)] = a

    linhas = []
    total_faltas = 0
    total_atestados = 0
    total_presencas = 0

    for func in funcionarios:
        data_cad = func.data_cadastro.date() if func.data_cadastro else date(2000, 1, 1)

        for d in range(1, dias_no_mes + 1):
            dia_corrente = date(ano, mes, d)
            dia_iso = dia_corrente.strftime("%Y-%m-%d")

            if dia_corrente > hoje or dia_corrente < data_cad:
                continue

            eh_fds = dia_corrente.weekday() >= 5
            regs = por_func_dia[func.id].get(dia_corrente, [])
            ajuste = ajustes_dict.get((func.id, dia_iso))

            if ajuste:
                # O admin realizou um ajuste manual ou cadastrou um atestado
                if ajuste.tipo_ajuste == "atestado":
                    total_atestados += 1
                    status_dia = "Atestado Médico"
                    entrada = ajuste.entrada or "Atestado"
                    almoco_s = ajuste.almoco_saida or "Atestado"
                    almoco_r = ajuste.almoco_retorno or "Atestado"
                    saida = ajuste.saida or "Atestado"
                    total_horas = "Abonado"
                elif ajuste.tipo_ajuste == "falta_justificada":
                    status_dia = "Falta Justificada"
                    entrada = "Justificada"
                    almoco_s = "Justificada"
                    almoco_r = "Justificada"
                    saida = "Justificada"
                    total_horas = "Abonado"
                else:  # manual
                    total_presencas += 1
                    status_dia = "Ajustado (ADM)"
                    entrada = ajuste.entrada or "Sem Registro"
                    almoco_s = ajuste.almoco_saida or "Sem Registro"
                    almoco_r = ajuste.almoco_retorno or "Sem Registro"
                    saida = ajuste.saida or "Sem Registro"
                    total_horas = calcular_horas_str(entrada, almoco_s, almoco_r, saida)

                motivo = ajuste.motivo or ""
            elif regs:
                total_presencas += 1
                status_dia = "Presente"
                entrada = next((r["timestamp_str"] for r in regs if r["tipo"] == "entrada"), "Sem Registro")
                almoco_s = next((r["timestamp_str"] for r in regs if r["tipo"] == "almoco_saida"), "Sem Registro")
                almoco_r = next((r["timestamp_str"] for r in regs if r["tipo"] == "almoco_retorno"), "Sem Registro")
                saida = next((r["timestamp_str"] for r in regs if r["tipo"] == "saida"), "Sem Registro")
                total_horas = calcular_horas_str(entrada, almoco_s, almoco_r, saida)
                motivo = ""
            else:
                if eh_fds:
                    continue
                total_faltas += 1
                status_dia = "FALTA"
                entrada = "FALTA"
                almoco_s = "FALTA"
                almoco_r = "FALTA"
                saida = "FALTA"
                total_horas = "0h 0min"
                motivo = ""

            linhas.append({
                "funcionario_id": func.id,
                "funcionario_nome": func.nome,
                "cargo": func.cargo,
                "data": dia_corrente.strftime("%d/%m/%Y"),
                "data_iso": dia_iso,
                "status": status_dia,
                "entrada": entrada,
                "almoco_saida": almoco_s,
                "almoco_retorno": almoco_r,
                "saida": saida,
                "total_horas": total_horas,
                "motivo": motivo
            })

    return linhas, total_faltas, total_atestados, total_presencas


@router.get("/mensal")
def relatorio_mensal(
    mes: int = Query(default=datetime.now().month, ge=1, le=12),
    ano: int = Query(default=datetime.now().year),
    funcionario_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    admin=Depends(get_admin_atual)
):
    linhas, total_faltas, total_atestados, total_presencas = extrair_linhas_periodo(db, ano, mes, funcionario_id)
    funcionarios_unicos = set(r["funcionario_id"] for r in linhas)

    return {
        "mes": mes,
        "ano": ano,
        "registros": linhas,
        "total_registros": len(linhas),
        "total_faltas": total_faltas,
        "total_atestados": total_atestados,
        "total_presencas": total_presencas,
        "funcionarios_no_periodo": len(funcionarios_unicos)
    }


@router.post("/ajuste")
def salvar_ajuste(
    dados: SalvarAjusteRequest,
    db: Session = Depends(get_db),
    admin=Depends(get_admin_atual)
):
    """Salva ou atualiza a justificativa/atestado/ajuste de ponto de um dia."""
    data_iso = converter_data_iso(dados.data)

    ajuste = db.query(AjustePonto).filter(
        AjustePonto.funcionario_id == dados.funcionario_id,
        AjustePonto.data == data_iso
    ).first()

    if not ajuste:
        ajuste = AjustePonto(
            funcionario_id=dados.funcionario_id,
            data=data_iso,
            tipo_ajuste=dados.tipo_ajuste,
            motivo=dados.motivo,
            entrada=dados.entrada,
            almoco_saida=dados.almoco_saida,
            almoco_retorno=dados.almoco_retorno,
            saida=dados.saida
        )
        db.add(ajuste)
    else:
        ajuste.tipo_ajuste = dados.tipo_ajuste
        ajuste.motivo = dados.motivo
        ajuste.entrada = dados.entrada
        ajuste.almoco_saida = dados.almoco_saida
        ajuste.almoco_retorno = dados.almoco_retorno
        ajuste.saida = dados.saida

    db.commit()
    return {"sucesso": True, "mensagem": "Ponto/Atestado ajustado com sucesso!"}


@router.get("/exportar")
def exportar_csv(
    mes: int = Query(default=datetime.now().month, ge=1, le=12),
    ano: int = Query(default=datetime.now().year),
    funcionario_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    admin=Depends(get_admin_atual)
):
    linhas, _, _, _ = extrair_linhas_periodo(db, ano, mes, funcionario_id)

    output = io.StringIO()
    writer = csv.writer(output, delimiter=";")
    writer.writerow(["Funcionário", "Cargo", "Data", "Situação", "Entrada", "Saída Almoço", "Retorno Almoço", "Saída", "Total Horas", "Observação/Atestado"])

    for linha in linhas:
        writer.writerow([
            linha["funcionario_nome"],
            linha["cargo"],
            linha["data"],
            linha["status"],
            linha["entrada"],
            linha["almoco_saida"],
            linha["almoco_retorno"],
            linha["saida"],
            linha["total_horas"],
            linha.get("motivo", "")
        ])

    output.seek(0)
    nome_arquivo = f"relatorio_ponto_{mes:02d}_{ano}.csv"
    return StreamingResponse(
        io.BytesIO(("\ufeff" + output.getvalue()).encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={nome_arquivo}"}
    )


@router.get("/semana")
def registros_semana(db: Session = Depends(get_db), admin=Depends(get_admin_atual)):
    hoje = datetime.now().date()
    sete_dias_atras = hoje - timedelta(days=6)
    inicio = datetime.combine(sete_dias_atras, datetime.min.time())

    registros = db.query(RegistroPonto).filter(
        RegistroPonto.timestamp >= inicio,
        RegistroPonto.tipo == "entrada"
    ).all()

    contagem = defaultdict(int)
    for r in registros:
        dia = r.timestamp.date()
        contagem[dia] += 1

    dias_nomes = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]
    resultado = []
    for i in range(7):
        dia = sete_dias_atras + timedelta(days=i)
        resultado.append({
            "dia": dia.strftime("%d/%m"),
            "dia_semana": dias_nomes[dia.weekday() + 1 if dia.weekday() < 6 else 0],
            "total": contagem[dia]
        })

    return resultado
