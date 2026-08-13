@echo off
title Cockpit - testes
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node nao encontrado no PATH. Instale o Node 22+ e tente de novo.
  pause
  exit /b 1
)

REM Os testes que nao gastam nada: sem modelo, sem rede, sem escrever no n8n.
REM O que gasta de verdade e o tester-smoke.js, que roda uma construcao inteira
REM e cobra do plano — ele fica de fora daqui de proposito.

set FALHOU=0

echo ==============================================
echo  esquema dos nos: o portao de parametro
echo ==============================================
node esquema-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  aviso de aba: favicon, titulo e notificacao
echo ==============================================
node aba-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  licoes: o que a base aprendeu sozinha
echo ==============================================
node licoes-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  portoes de agente conversacional
echo ==============================================
node agentes-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  orcamento dos prompts (linha de comando)
echo ==============================================
node prompt-budget-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  remendo de projeto salvo (edicao)
echo ==============================================
node edicao-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  lixeira: excluir move, restaurar volta
echo ==============================================
node lixeira-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  credenciais: checklist e ligacao automatica
echo ==============================================
node credenciais-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  o fantasma (auto-teste do simulador)
echo ==============================================
node simulate.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  anexos: print, pdf, pasta e o que nao entra
echo ==============================================
node anexos-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  nota permanente do quadro de erros (fixNote)
echo ==============================================
node fixnote-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  parar no meio (Esc) e o gasto que ninguem mediu
echo ==============================================
node cancelar-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  novidades do n8n: o job diario que escreve sozinho
echo ==============================================
node novidades-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  navegacao: um bloco so, nas tres paginas
echo ==============================================
node nav-sync-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  reexecutar: o unico efeito sem desfazer
echo ==============================================
node reexec-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  caractere de controle nos arquivos servidos
echo ==============================================
node caractere-test.js
if errorlevel 1 set FALHOU=1

echo.
if "%FALHOU%"=="1" (
  echo RESULTADO: alguma coisa falhou. Role para cima.
) else (
  echo RESULTADO: tudo passou.
)
echo.
echo Para provar o que importa de verdade — o fluxo que sai da ponta — rode:
echo   node tester-smoke.js "a sua ideia" --rodadas 3
echo Esse gasta cota do plano.
echo.
pause
