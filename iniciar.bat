@echo off
chcp 65001 > nul
cls
echo =====================================================
echo       🕐 SISTEMA DE PONTO ELETRÔNICO MOBILITTÀ
echo =====================================================
echo.

REM Verifica se Python esta instalado
python --version > nul 2>&1
if %errorlevel% neq 0 (
    echo [ERRO] Python nao encontrado!
    echo Por favor instale Python 3.9+ em https://python.python.org
    pause
    exit /b 1
)

cd /d "%~dp0"

echo [1/1] Iniciando servidor com suporte a camera segura (HTTPS)...
echo.
echo =====================================================
echo   💻 No Computador:    https://localhost:8000
echo   📱 No Celular Wi-Fi: https://192.168.100.10:8000
echo   ⚙️ Painel Admin:     https://localhost:8000/admin
echo   ☁️ Online (Render):  https://ponto-icaa.onrender.com
echo =====================================================
echo.
echo DICA: Se o navegador avisar "Sua conexao nao e privada",
echo clique em "Avancado" e depois em "Continuar para localhost".
echo.
echo Pressione Ctrl+C para parar o servidor a qualquer momento.
echo.

python main.py
pause
