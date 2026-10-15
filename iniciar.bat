@echo off
chcp 65001 >nul
title Habblaud - Escritorio Virtual

echo ========================================================
echo   Iniciando Habblaud com todos os opcionais ativos
echo   - Terminal Interativo (PTY)
echo   - Envio de Comandos e Mensagens
echo   - Cotas e Statusline
echo   - Suporte a Antigravity, Claude Code e Codex
echo ========================================================
echo.

:: Abre o navegador apos 2 segundos em segundo plano
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:4747"

:: Inicia o servidor com o arquivo .env
node --env-file-if-exists=.env dist\server\index.js

if %ERRORLEVEL% neq 0 (
  echo.
  echo O servidor parou com codigo %ERRORLEVEL%.
  pause
)
