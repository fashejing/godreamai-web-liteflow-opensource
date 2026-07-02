@echo off
setlocal

set "ROOT_DIR=%~dp0.."
set "PYTHON_BIN=%ROOT_DIR%\.venv\Scripts\python.exe"
set "RUNTIME_PYTHON=%ROOT_DIR%\python\python.exe"

cd /d "%ROOT_DIR%"
if exist "%PYTHON_BIN%" (
  "%PYTHON_BIN%" -m web_lite3
  goto :eof
)
if exist "%RUNTIME_PYTHON%" (
  "%RUNTIME_PYTHON%" -m web_lite3
  goto :eof
)
python -m web_lite3
