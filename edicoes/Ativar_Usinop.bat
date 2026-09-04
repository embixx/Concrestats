@echo off
title Concrestats - ativar a edicao Usinop
cd /d "%~dp0"

echo.
echo   Concrestats - edicao Usinop (sem a aba PAINEL)
echo   ---------------------------------------------
echo.

rem  O arquivo tem de ficar NA MESMA PASTA do Concrestats.exe. Se este .bat
rem  foi parar em outro lugar, escrever aqui nao adianta nada - e o pior e'
rem  que nao daria erro nenhum: o app abriria normal, com o Painel no lugar,
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

> "edicao.json" echo {
>>"edicao.json" echo   "nome": "Usinop",
>>"edicao.json" echo   "ocultar": ["painel"]
>>"edicao.json" echo }

if not exist "edicao.json" (
  echo   Nao consegui gravar o arquivo nesta pasta.
  echo   Tente clicar com o botao direito e "Executar como administrador".
  echo.
  pause
  exit /b 1
)

echo   Pronto.
echo.
echo   Abra o Concrestats: a aba PAINEL nao aparece mais, e na tela
echo   inicial, embaixo da versao, deve aparecer "edicao Usinop".
echo   Se nao aparecer, o arquivo foi para a pasta errada.
echo.
echo   Para desfazer: apague o arquivo edicao.json desta pasta.
echo.
pause
