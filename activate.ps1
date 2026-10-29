# Kich hoat moi truong co lap cho du an. Dung: . .\activate.ps1
# Moi thu (Node, npm cache, Expo state, temp) deu nam trong folder nay.

$root = $PSScriptRoot

$env:PATH = "$root\.tools\node;$root\.tools\npm-global;$root\node_modules\.bin;$env:PATH"

$env:npm_config_cache = "$root\.cache\npm"
$env:npm_config_prefix = "$root\.tools\npm-global"
$env:npm_config_update_notifier = "false"

$env:HOME = "$root\.home"
$env:USERPROFILE = "$root\.home"
$env:APPDATA = "$root\.home\AppData\Roaming"
$env:LOCALAPPDATA = "$root\.home\AppData\Local"
$env:TEMP = "$root\.tmp"
$env:TMP = "$root\.tmp"

$env:EXPO_NO_TELEMETRY = "1"

# Python (server): venv o server\.venv, pip cache trong folder
$env:PIP_CACHE_DIR = "$root\.cache\pip"
$env:PYTHONUSERBASE = "$root\.home\python-user"
$env:PIP_DISABLE_PIP_VERSION_CHECK = "1"

foreach ($d in @(".cache\npm", ".cache\pip",".tools\npm-global", ".home\AppData\Roaming", ".home\AppData\Local", ".tmp")) {
    New-Item -ItemType Directory -Force "$root\$d" | Out-Null
}

Write-Host "Moi truong Scan da kich hoat. Node $(node -v)" -ForegroundColor Green
