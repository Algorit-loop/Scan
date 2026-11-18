# Build thư viện docdetect (detect v2, C++) cho server Windows bằng MinGW.
# Dùng (từ thư mục gốc dự án):  .\Core\native\docdetect\build.ps1
#
# Lần đầu: build OpenCV tĩnh tối giản (chỉ core + imgproc, ~5-10 phút) vào .tools\opencv-mingw.
# Cần: g++ (MinGW-w64), cmake, ninja trong PATH; source OpenCV ở .tools\src\opencv-4.10.0
#      (tải: https://github.com/opencv/opencv/archive/refs/tags/4.10.0.zip rồi giải nén vào .tools\src).

# cmake ghi cảnh báo ra stderr; PowerShell 5.1 coi đó là lỗi nếu để "Stop". Lỗi thật được bắt qua $LASTEXITCODE.
$ErrorActionPreference = "Continue"
$root = Resolve-Path "$PSScriptRoot\..\..\.."  # thư mục gốc dự án (chứa .tools)
$tools = "$root\.tools"
$ocvSrc = "$tools\src\opencv-4.10.0"
$ocvBuild = "$tools\src\opencv-build"
$ocvInstall = "$tools\opencv-mingw"

foreach ($c in "g++", "cmake", "ninja") {
    if (-not (Get-Command $c -ErrorAction SilentlyContinue)) { throw "Không thấy '$c' trong PATH" }
}

# Lấy file cấu hình trong thư mục staticlib (file ở gốc thư mục cài không nhận MinGW).
function Find-OcvConfig { Get-ChildItem $ocvInstall -Recurse -Filter OpenCVConfig.cmake -ErrorAction SilentlyContinue | Sort-Object { $_.FullName.Length } -Descending | Select-Object -First 1 }
$ocvConfig = Find-OcvConfig
if (-not $ocvConfig) {
    if (-not (Test-Path $ocvSrc)) { throw "Chưa có source OpenCV ở $ocvSrc" }
    Write-Host "== Build OpenCV (core + imgproc, tĩnh) ==" -ForegroundColor Cyan
    cmake -S $ocvSrc -B $ocvBuild -G Ninja `
        -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_COMPILER=gcc -DCMAKE_CXX_COMPILER=g++ `
        -DCMAKE_INSTALL_PREFIX="$ocvInstall" `
        "-DBUILD_LIST=core,imgproc" -DBUILD_SHARED_LIBS=OFF -DBUILD_opencv_world=OFF `
        -DBUILD_TESTS=OFF -DBUILD_PERF_TESTS=OFF -DBUILD_EXAMPLES=OFF -DBUILD_DOCS=OFF -DBUILD_opencv_apps=OFF `
        -DBUILD_opencv_python3=OFF -DBUILD_JAVA=OFF -DBUILD_opencv_js=OFF `
        -DWITH_IPP=OFF -DWITH_ITT=OFF -DWITH_OPENCL=OFF -DWITH_EIGEN=OFF -DWITH_LAPACK=OFF -DWITH_ADE=OFF `
        -DWITH_PROTOBUF=OFF -DWITH_FFMPEG=OFF -DWITH_MSMF=OFF -DWITH_DSHOW=OFF -DWITH_WIN32UI=OFF `
        -DWITH_JPEG=OFF -DWITH_PNG=OFF -DWITH_TIFF=OFF -DWITH_WEBP=OFF -DWITH_OPENJPEG=OFF -DWITH_OPENEXR=OFF `
        -DBUILD_ZLIB=ON -DOPENCV_GENERATE_PKGCONFIG=OFF -DCV_TRACE=OFF -DENABLE_PRECOMPILED_HEADERS=OFF
    if ($LASTEXITCODE) { throw "cmake OpenCV lỗi" }
    cmake --build $ocvBuild --parallel
    if ($LASTEXITCODE) { throw "build OpenCV lỗi" }
    cmake --install $ocvBuild
    $ocvConfig = Find-OcvConfig
}

Write-Host "== Build docdetect ==" -ForegroundColor Cyan
cmake -S $PSScriptRoot -B "$PSScriptRoot\build" -G Ninja -DCMAKE_BUILD_TYPE=Release `
    -DCMAKE_CXX_COMPILER=g++ -DOPENCV_STATIC_ROOT="$ocvInstall"
if ($LASTEXITCODE) { throw "cmake docdetect lỗi" }
cmake --build "$PSScriptRoot\build"
if ($LASTEXITCODE) { throw "build docdetect lỗi" }
Write-Host "Xong: $PSScriptRoot\build\docdetect.dll" -ForegroundColor Green
