@echo off
chcp 65001 > nul
cls
echo =====================================================
echo       📱 GERADOR DO APK - PONTO ELETRÔNICO
echo =====================================================
echo.

cd /d "%~dp0"

echo [1/3] Sincronizando arquivos do batedor de ponto para o aplicativo Android...
copy /y "public\index.html" "android_app\app\src\main\assets\index.html" > nul
copy /y "public\css\style.css" "android_app\app\src\main\assets\css\style.css" > nul
copy /y "public\js\ponto.js" "android_app\app\src\main\assets\js\ponto.js" > nul
xcopy /s /e /y "public\models\*" "android_app\app\src\main\assets\models\" > nul

echo [2/3] Compilando APK nativo Android com Gradle...
cd android_app
call "C:\Users\bruno\.gradle\wrapper\dists\gradle-8.9-bin\90cnw93cvbtalezasaz0blq0a\gradle-8.9\bin\gradle.bat" assembleDebug
cd ..

if exist "android_app\app\build\outputs\apk\debug\app-debug.apk" (
    echo [3/3] Copiando APK gerado...
    copy /y "android_app\app\build\outputs\apk\debug\app-debug.apk" "Ponto_Eletronico.apk" > nul
    copy /y "android_app\app\build\outputs\apk\debug\app-debug.apk" "public\Ponto_Eletronico.apk" > nul
    echo.
    echo =====================================================
    echo   [SUCESSO] APK gerado com sucesso!
    echo   Arquivo: Ponto_Eletronico.apk (na pasta do projeto)
    echo =====================================================
) else (
    echo.
    echo [ERRO] Ocorreu uma falha ao compilar o APK. Verifique os logs acima.
)

echo.
pause
