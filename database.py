from sqlalchemy import create_engine, Column, Integer, String, Boolean, DateTime, Float, Text, ForeignKey, Date
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime

DATABASE_URL = "sqlite:///./ponto.db"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class Funcionario(Base):
    __tablename__ = "funcionarios"

    id = Column(Integer, primary_key=True, index=True)
    nome = Column(String(200), nullable=False)
    cpf = Column(String(14), unique=True, nullable=False)
    cargo = Column(String(100), nullable=False)
    departamento = Column(String(100), nullable=False)
    email = Column(String(200), nullable=True)
    ativo = Column(Boolean, default=True)
    foto_path = Column(String(500), nullable=True)
    encoding_facial = Column(Text, nullable=True)  # JSON string com lista de floats
    data_cadastro = Column(DateTime, default=datetime.now)

    registros = relationship("RegistroPonto", back_populates="funcionario")
    ajustes = relationship("AjustePonto", back_populates="funcionario")


class RegistroPonto(Base):
    __tablename__ = "registros_ponto"

    id = Column(Integer, primary_key=True, index=True)
    funcionario_id = Column(Integer, ForeignKey("funcionarios.id"), nullable=False)
    tipo = Column(String(30), nullable=False)  # entrada, saida, almoco_saida, almoco_retorno
    timestamp = Column(DateTime, default=datetime.now)
    foto_registro = Column(String(500), nullable=True)
    confianca = Column(Float, nullable=True)
    observacao = Column(String(500), nullable=True)

    funcionario = relationship("Funcionario", back_populates="registros")


class AjustePonto(Base):
    __tablename__ = "ajustes_ponto"

    id = Column(Integer, primary_key=True, index=True)
    funcionario_id = Column(Integer, ForeignKey("funcionarios.id"), nullable=False)
    data = Column(String(10), nullable=False)  # YYYY-MM-DD
    tipo_ajuste = Column(String(30), nullable=False)  # manual, atestado, falta_justificada
    motivo = Column(String(500), nullable=True)  # ex: CID ou detalhe do atestado
    entrada = Column(String(8), nullable=True)   # HH:MM
    almoco_saida = Column(String(8), nullable=True)
    almoco_retorno = Column(String(8), nullable=True)
    saida = Column(String(8), nullable=True)
    anexo_path = Column(String(500), nullable=True)
    criado_em = Column(DateTime, default=datetime.now)

    funcionario = relationship("Funcionario", back_populates="ajustes")


class AdminUser(Base):
    __tablename__ = "admin_users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False)
    senha_hash = Column(String(200), nullable=False)
    nome = Column(String(200), nullable=False)
    ativo = Column(Boolean, default=True)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def criar_tabelas():
    Base.metadata.create_all(bind=engine)
