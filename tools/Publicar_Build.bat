@echo off
title Concrestats - Publicar build no Trello
echo.
echo  Publicando a build atual no Trello (o Naor recebe notificacao)...
echo.
cd /d "%~dp0.."
call "source\.venv\Scripts\python.exe" tools\publicar_build.py
echo.
pause
