@echo off
title Concrestats - Publicar build no Trello
echo.
echo  Publicando a build atual no Trello (o Naor recebe notificacao)...
echo.
cd /d "C:\Users\Administrator\Desktop\projetos\Concrestats(1)"
"C:\Users\Administrator\Desktop\projetos\Concrestats(1)\source\.venv\Scripts\python.exe" tools\publicar_build.py
echo.
pause
