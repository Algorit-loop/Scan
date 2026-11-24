# Chay server dang ky / dang nhap. Dung:  .\Server\run.ps1   (tu thu muc goc du an)
# Doi cong:  $env:PORT = 4001; .\Server\run.ps1
$ErrorActionPreference = "Stop"
. "$PSScriptRoot\..\activate.ps1"
Set-Location $PSScriptRoot
node src/index.mjs
