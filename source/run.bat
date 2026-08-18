@echo off
REM Roda o Concrestats em modo desenvolvimento (sem empacotar).
setlocal
if not exist .venv (
  python -m venv .venv
  call .venv\Scripts\activate.bat
  python -m pip install -r requirements.txt
) else (
  call .venv\Scripts\activate.bat
)
echo Abrindo http://127.0.0.1:5000 ...
python app.py
