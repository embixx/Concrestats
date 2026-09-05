@echo off
title Concrestats - canal Teste
cd /d "%~dp0"

echo.
echo   Concrestats - canal Teste
echo   recebe as versoes antes e MOSTRA a aba PAINEL
echo.

rem  Tem de ficar NA MESMA PASTA do Concrestats.exe. Noutro lugar nao faria
rem  nada, e nao daria erro nenhum - o programa continuaria no canal de antes
rem  e ninguem entenderia por que.
if not exist "Concrestats.exe" (
  echo   PARE. Nao achei o Concrestats.exe nesta pasta.
  echo.
  echo   Coloque este arquivo na MESMA pasta onde esta o Concrestats.exe
  echo   e clique duas vezes de novo.
  echo.
  echo   Pasta atual: %CD%
  echo.
  pause
  exit /b 1
)

> "canal.txt" echo teste

echo   Pronto. Feche e abra o Concrestats.
echo.
echo   Confira na tela de Atualizacao: o canal aparece como Teste.
echo.
pause
