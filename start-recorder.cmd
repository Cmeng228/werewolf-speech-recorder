@echo off
setlocal
cd /d "%~dp0"
"C:\Users\cob\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" tools\server.mjs
