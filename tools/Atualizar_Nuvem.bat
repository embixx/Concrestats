@echo off
title Concrestats - Atualizar pasta da nuvem
echo.
echo  Atualizando a pasta Concrestats_Nuvem com a build mais recente...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0atualizar_nuvem.ps1"
echo.
pause
