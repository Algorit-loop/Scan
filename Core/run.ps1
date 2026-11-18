# Chay web visualize cua Core. Dung (tu thu muc goc du an):  .\Core\run.ps1
# Mo http://localhost:8000/  — moi trang co URL rieng, mo nhieu tab de so sanh.

$here = $PSScriptRoot
. "$here\..\activate.ps1"

$py = "$here\.venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
    Write-Host "Chua co venv. Dang tao..." -ForegroundColor Yellow
    python -m venv "$here\.venv"
    & $py -m pip install -r "$here\requirements.txt"
}

$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    Select-Object -ExpandProperty IPAddress
Write-Host "Web dang chay tai:" -ForegroundColor Green
Write-Host "  http://localhost:8000/"
foreach ($ip in $ips) { Write-Host "  http://${ip}:8000/" }

Push-Location $here
try {
    & $py -m uvicorn web.main:app --host 0.0.0.0 --port 8000 @args
} finally {
    Pop-Location
}
