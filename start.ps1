# Start both backend and frontend in separate windows
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"

Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$backend'; uvicorn main:app --reload"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$frontend'; npm run dev"

Write-Host "Started backend on http://127.0.0.1:8000"
Write-Host "Started frontend on http://localhost:5173"
