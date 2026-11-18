# Build v3 on Windows using the existing minimal static OpenCV installation.
# Usage from repository root: .\Core\native\docdetect_v3\build.ps1
# CMakeLists.txt is available for Android/iOS or other CMake toolchains.
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path "$PSScriptRoot/../../..").Path
$opencv = "$repo/.tools/opencv-mingw"
if (-not (Test-Path "$opencv/include/opencv2/core.hpp")) {
    throw "Build OpenCV first with Core/native/docdetect/build.ps1."
}
$compiler = (Get-Command g++ -ErrorAction Stop).Source
$libdir = "$opencv/x64/mingw/staticlib"
$imgproc = (Get-ChildItem -LiteralPath $libdir -Filter 'libopencv_imgproc*.a' | Select-Object -First 1).FullName
$core = (Get-ChildItem -LiteralPath $libdir -Filter 'libopencv_core*.a' | Select-Object -First 1).FullName
$build = "$PSScriptRoot/build"
New-Item -ItemType Directory -Force $build, "$repo/.tmp" | Out-Null
$oldTemp = $env:TEMP
$oldTmp = $env:TMP
try {
    $env:TEMP = "$repo/.tmp"
    $env:TMP = $env:TEMP
    $sources = @('detect', 'geometry', 'lines', 'quads', 'scoring') | ForEach-Object { "$PSScriptRoot/src/$_.cpp" }
    & $compiler -std=c++17 -O3 -DNDEBUG -shared -static -static-libgcc -static-libstdc++ -Wall `
        "-I$PSScriptRoot/include" "-I$PSScriptRoot/src" "-I$opencv/include" `
        @sources $imgproc $core "$libdir/libzlib.a" -o "$build/docdetect_v3.dll"
    if ($LASTEXITCODE -ne 0) { throw "v3 build failed ($LASTEXITCODE). Stop the web server if its DLL is loaded." }
    Write-Host "Built $build/docdetect_v3.dll"
} finally {
    $env:TEMP = $oldTemp
    $env:TMP = $oldTmp
}
