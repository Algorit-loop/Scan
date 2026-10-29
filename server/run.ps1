# Chay server xu ly anh. Dung (tu thu muc goc du an):  .\server\run.ps1
# Dien thoai phai chung Wi-Fi voi may nay. App tu tim server qua dia chi cua Metro (cong 8000).

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
Write-Host "Server dang chay tai:" -ForegroundColor Green
foreach ($ip in $ips) { Write-Host "  http://${ip}:8000/   (trang web kiem tra detect; /health cho app)" }
Write-Host "Lan dau chay, Windows co the hoi cho phep Python qua tuong lua: chon 'Private networks'." -ForegroundColor Yellow

Push-Location $here
try {
    & $py -m uvicorn app.main:app --host 0.0.0.0 --port 8000
} finally {
    Pop-Location
}
