@echo off
title Cockpit de Projetos
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node nao encontrado no PATH. Instale o Node 22+ e tente de novo.
  pause
  exit /b 1
)

if not exist ".env" (
  echo AVISO: .env nao encontrado. O painel de fluxos n8n vai subir vazio.
  echo Crie .env com N8N_BASE_URL e N8N_API_KEY.
  echo.
)

echo Subindo o cockpit em http://localhost:4317
echo   /       painel de fluxos n8n ^(ao vivo^)
echo   /disco  varredura de projetos em disco
echo Feche esta janela para parar o servidor.
echo.

start "" http://localhost:4317
node server.js

echo.
echo Servidor encerrado.
pause
