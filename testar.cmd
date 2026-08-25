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
echo  pii: telefone nunca sai cru da fronteira
echo ==============================================
node pii-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  cofre: a chave do n8n cifrada pelo Windows
echo ==============================================
node cofre-test.js
node cofre-n8n-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  integracoes: fato no modulo, juizo na tela
echo ==============================================
node integracoes-test.js
node cabecalhos-api-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  voz e anexo: um arquivo servido, nenhuma copia
echo ==============================================
node entradas-test.js
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
node cofre-tela-test.js
node perfil-test.js
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
echo  audio: a transcricao, e a atribuicao pela aresta
echo ==============================================
node audio-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  upgrade: a conversa que termina no alvo
echo ==============================================
node upgrade-test.js
node regras-anexo-test.js
node seletor-test.js
node anexo-bolha-test.js
node aplicar-test.js
node remendo-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  teto da rodada: travou x demorou, e o esforco
echo ==============================================
node rodada-teto-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  conversas: o historico, e o ledger sem texto
echo ==============================================
node conversas-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  ledger de dois tipos: upgrade nao expulsa correcao
echo ==============================================
node ledger-kind-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  evidencia: ve valor sem ver contato, e nao escreve
echo ==============================================
node evidencia-test.js
node preencher-test.js
node rede-test.js
node rede-fix-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  faixa do dossie: quatro estados, quatro frases
echo ==============================================
node dossie-tela-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  telinha de progresso: campo ausente nao e "sem regua"
echo ==============================================
node dossie-progresso-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  semaforo do dossie na vitrine, e a oferta no recibo
echo ==============================================
node dossie-vitrine-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  dossie: divergencia por impressao, zero valor no .md
echo ==============================================
node dossie-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  dossie incremental: heranca, e as tres travas
echo ==============================================
node dossie-incremental-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  dossie automatico: depois de aplicar o patch
echo ==============================================
node auto-dossie-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  fila de escrita: reentrante por dono, sem deadlock
echo ==============================================
node mutex-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  escrever aprovado: a ordem e a garantia
echo ==============================================
node escrever-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  dono da escrita: os seis call sites do n8n
echo ==============================================
node dono-test.js
node ambiente-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  qual IA roda a rodada, e a fiacao nos quatro spawns
echo ==============================================
node ia-test.js
node ia-fiacao-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  leitura em rajada, e o fio sem campo orfao
echo ==============================================
node rajada-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  CSS: nenhuma regra aberta nas quatro paginas
echo ==============================================
node css-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  negociacao da resposta estatica: gzip, ETag, 304
echo ==============================================
node estatico-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  o ligamento no server.js: 304, edicao vale, SSE fora
echo ==============================================
node estatico-servidor-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  o palco preservado entre repaints (upgrade)
echo ==============================================
node palco-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  o desenho preservado, e o log que nao custa snapshot
echo ==============================================
node desenho-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  o tique vazio, os relogios, e a poda do S.details
echo ==============================================
node tique-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  /disco: o cache de rows e a busca sem perder o caret
echo ==============================================
node disco-test.js
if errorlevel 1 set FALHOU=1

REM Estes dois existiam e nunca estiveram aqui: rodavam so na mao, o que na
REM pratica quer dizer que nao rodavam.
echo.
echo ==============================================
echo  a bateria dos sete (upgrade): cinza nunca e verde
echo ==============================================
node bateria-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  regressao de caminho e de conteudo
echo ==============================================
node regressao-test.js
if errorlevel 1 set FALHOU=1

echo.
echo ==============================================
echo  guarda na porta do agente (CORS, token, dono)
echo ==============================================
node guarda-test.js
node pareamento-test.js
node pareamento-tela-test.js
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
