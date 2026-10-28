@echo off
chcp 65001 > nul
cls
echo =====================================================
echo      SISTEMA DE PONTO ELETRONICO
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

echo [1/2] Instalando dependencias Python...
pip install -r requirements.txt --quiet
if %errorlevel% neq 0 (
    echo.
    echo [AVISO] Erro ao instalar algumas dependencias.
    echo Se o face_recognition falhar, instale o Visual C++ Build Tools primeiro:
    echo https://visualstudio.microsoft.com/visual-cpp-build-tools/
    echo.
)

echo.
echo [2/2] Iniciando servidor...
echo.
echo =====================================================
echo  Acesse em: http://localhost:8000
echo  Admin:     http://localhost:8000/admin
echo  Login:     admin / admin123
echo =====================================================
echo.
echo Pressione Ctrl+C para parar o servidor.
echo.

python main.py
pause
