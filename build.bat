@echo off
setlocal
cd /d "%~dp0"

echo [1/3] Ativando venv e instalando PyInstaller...
call .venv\Scripts\activate.bat
if errorlevel 1 (
  echo Crie o venv antes: python -m venv .venv ^&^& .venv\Scripts\activate ^&^& pip install -r requirements.txt
  exit /b 1
)
pip install -q -r requirements-dev.txt

echo [2/3] Gerando executavel (pode demorar)...
pyinstaller --noconfirm Transcriptor.spec
if errorlevel 1 exit /b 1

echo [3/3] Criando ZIP baixavel...
if exist "dist\Transcriptor.zip" del /f "dist\Transcriptor.zip"
powershell -NoProfile -Command "Compress-Archive -Path 'dist\Transcriptor\*' -DestinationPath 'dist\Transcriptor.zip' -Force"

echo.
echo Pronto!
echo   Pasta: dist\Transcriptor\Transcriptor.exe
echo   ZIP:   dist\Transcriptor.zip
echo.
echo Anexe o ZIP na Release do GitHub (veja docs\RELEASE_NOTES_v0.1.0.md)
pause
