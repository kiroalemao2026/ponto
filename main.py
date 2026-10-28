import os
import uvicorn
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse

from database import criar_tabelas, SessionLocal, AdminUser, Funcionario
from routers.auth import criar_hash_senha
from routers import auth, funcionarios, ponto, relatorios

# Cria as tabelas no banco
criar_tabelas()

app = FastAPI(
    title="Sistema de Ponto Eletrônico",
    description="Sistema de controle de ponto com reconhecimento facial",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Cria diretórios necessários
os.makedirs("fotos_funcionarios", exist_ok=True)
os.makedirs("fotos_registros", exist_ok=True)
os.makedirs("static/css", exist_ok=True)
os.makedirs("static/js", exist_ok=True)

# Arquivos estáticos da aplicação Firebase
if os.path.exists("public"):
    app.mount("/models", StaticFiles(directory="public/models"), name="models")
    app.mount("/js", StaticFiles(directory="public/js"), name="js")
    app.mount("/css", StaticFiles(directory="public/css"), name="css")

# Arquivos estáticos e templates antigos
app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/fotos", StaticFiles(directory="fotos_funcionarios"), name="fotos")

# Jinja2 com cache desativado para compatibilidade com Python 3.14
import jinja2 as _jinja2
_jinja2_env = _jinja2.Environment(
    loader=_jinja2.FileSystemLoader("templates"),
    autoescape=_jinja2.select_autoescape(["html"]),
    cache_size=0,  # Desativa cache que causa bug no Python 3.14
    auto_reload=True
)
templates = Jinja2Templates(env=_jinja2_env)

# Inclui routers
app.include_router(auth.router)
app.include_router(funcionarios.router)
app.include_router(ponto.router)
app.include_router(relatorios.router)

# Rota raiz: serve o frontend Firebase moderno
from fastapi.responses import FileResponse

@app.get("/", response_class=FileResponse)
async def pagina_inicial_firebase():
    if os.path.exists("public/index.html"):
        return FileResponse("public/index.html")
    return HTMLResponse("<h1>Carregando...</h1>")

@app.get("/login.html", response_class=FileResponse)
async def pagina_login_firebase():
    return FileResponse("public/login.html")

@app.get("/admin.html", response_class=FileResponse)
async def pagina_admin_firebase():
    return FileResponse("public/admin.html")



def inicializar_dados():
    """Cria dados iniciais se não existirem."""
    db = SessionLocal()
    try:
        # Cria admin padrão
        admin_existente = db.query(AdminUser).filter(AdminUser.username == "admin").first()
        if not admin_existente:
            admin = AdminUser(
                username="admin",
                senha_hash=criar_hash_senha("admin123"),
                nome="Administrador",
                ativo=True
            )
            db.add(admin)
            db.commit()
            print("✅ Admin padrão criado: admin / admin123")
    finally:
        db.close()


# Inicializa dados ao subir
inicializar_dados()


# ===== ROTAS DE PÁGINAS =====

@app.get("/", response_class=HTMLResponse)
async def pagina_inicial(request: Request):
    return templates.TemplateResponse(request, "index.html")


@app.get("/admin", response_class=HTMLResponse)
async def pagina_admin(request: Request):
    return templates.TemplateResponse(request, "admin/dashboard.html")


@app.get("/admin/funcionarios", response_class=HTMLResponse)
async def pagina_funcionarios(request: Request):
    return templates.TemplateResponse(request, "admin/funcionarios.html")


@app.get("/admin/relatorios", response_class=HTMLResponse)
async def pagina_relatorios(request: Request):
    return templates.TemplateResponse(request, "admin/relatorios.html")


@app.get("/login", response_class=HTMLResponse)
async def pagina_login(request: Request):
    return templates.TemplateResponse(request, "login.html")


if __name__ == "__main__":
    import os
    ssl_cert = "cert.pem" if os.path.exists("cert.pem") else None
    ssl_key = "key.pem" if os.path.exists("key.pem") else None
    proto = "https" if ssl_cert else "http"

    print("=" * 60)
    print("  🕐 SISTEMA DE PONTO ELETRÔNICO")
    print("=" * 60)
    print(f"  Local:    {proto}://localhost:8000")
    print(f"  Celular:  {proto}://192.168.100.10:8000")
    print(f"  Admin:    {proto}://localhost:8000/admin")
    print("  Login:    admin / admin123")
    print("=" * 60)

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        ssl_certfile=ssl_cert,
        ssl_keyfile=ssl_key,
        reload=True
    )
