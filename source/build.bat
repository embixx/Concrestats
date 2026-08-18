@echo off
REM ===================================================================
REM  Build do Concrestats (Windows) - requer Python 3.11 instalado.
REM  Gera dist\Concrestats\Concrestats.exe (onedir).
REM ===================================================================
setlocal

echo [1/4] Criando ambiente virtual (.venv)...
python -m venv .venv
call .venv\Scripts\activate.bat

echo [2/4] Instalando dependencias...
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if errorlevel 1 goto :erro

echo [3/4] Empacotando com PyInstaller...
python -m PyInstaller --clean --noconfirm Concrestats.spec
if errorlevel 1 goto :erro

echo [4/4] Pronto.
echo.
echo Executavel gerado em:  dist\Concrestats\Concrestats.exe
echo (copie tambem as pastas uploads\ e exports\ para o lado do .exe, se quiser)
echo.
pause
exit /b 0

:erro
echo.
echo *** FALHA NO BUILD - verifique as mensagens acima ***
pause
exit /b 1
