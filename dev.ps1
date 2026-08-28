# Local dev on Windows: start the inference server with the viewer at
# http://localhost:$PORT   (PowerShell counterpart of dev.sh)
#
# Usage:
#   .\dev.ps1                 # default port 8000
#   $env:PORT=8123; .\dev.ps1 # override
#
# --reload picks up edits to server\*.py and the buildingcv package without a
# manual restart. Edits to viewer\index.html are served fresh on every
# request, so a browser hard-reload (Ctrl+Shift+R) is enough.

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$Port = if ($env:PORT) { [int]$env:PORT } else { 8000 }
$Py = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"

if (-not (Test-Path $Py)) {
    Write-Error "No .venv found. Create it first:`n  uv venv --python 3.12 .venv`n  uv pip install -e `".[serve]`"  (see README)"
}

# Friendly preflight: if something else already holds the port, say so and
# suggest the fix instead of letting uvicorn fail with a raw socket error.
$inUse = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($inUse) {
    $pids = ($inUse.OwningProcess | Sort-Object -Unique)
    Write-Host "Port $Port is already in use by PID(s): $($pids -join ', ')" -ForegroundColor Yellow
    foreach ($procId in $pids) {
        $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($p) { Write-Host ("  {0}  {1}" -f $p.Id, $p.ProcessName) }
    }
    Write-Host ""
    Write-Host "Either stop that process, or run on another port:  `$env:PORT=$($Port + 1); .\dev.ps1"
    exit 1
}

if (-not (Test-Path (Join-Path $PSScriptRoot "weights\best.safetensors"))) {
    Write-Host "weights\best.safetensors not found - fetching it now..." -ForegroundColor Cyan
    & $Py (Join-Path $PSScriptRoot "scripts\fetch_weights.py")
}

Write-Host "-> http://localhost:$Port" -ForegroundColor Green
& $Py -m uvicorn server.main:app --reload --host 127.0.0.1 --port $Port
