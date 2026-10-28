@echo off
chcp 65001 > nul
cls
echo =====================================================
echo    ENVIANDO SISTEMA DE PONTO PARA O GITHUB
echo =====================================================
echo.
echo Conectando com https://github.com/kiroalemao2026/ponto.git
echo.
cd /d "%~dp0"
git push -u origin main
echo.
if %errorlevel% equ 0 (
    echo [SUCESSO] Todos os arquivos foram enviados para o seu GitHub!
) else (
    echo [AVISO] Ocorreu algum erro ao enviar. Verifique seu login do GitHub acima.
)
echo.
pause
