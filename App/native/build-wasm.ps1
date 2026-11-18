# Build docdetect_v3 (Core/native/docdetect_v3) + OpenCV core/imgproc thành WebAssembly cho màn hình quét.
# Dùng: từ thư mục gốc, sau khi . .\activate.ps1:   .\App\native\build-wasm.ps1
# Cần Emscripten SDK ở .tools/emsdk (emsdk install latest; emsdk activate latest).
# Kết quả: App/native/build/docdetect.js (wasm nhúng sẵn, SINGLE_FILE), rồi sinh lại trang quét.
param([switch]$NoSimd)
$ErrorActionPreference = "Stop"

$repo = (Resolve-Path "$PSScriptRoot/../..").Path
$emsdk = "$repo/.tools/emsdk"
$opencvSrc = "$repo/.tools/src/opencv-4.10.0"
$opencvBuild = "$repo/.tools/src/opencv-wasm-build"
$opencv = "$repo/.tools/opencv-wasm"
$dd3 = "$repo/Core/native/docdetect_v3"
$out = "$PSScriptRoot/build"

if (-not (Test-Path "$emsdk/emsdk_env.ps1")) { throw "Thiếu Emscripten SDK ở $emsdk." }
if (-not (Test-Path "$opencvSrc/CMakeLists.txt")) { throw "Thiếu mã nguồn OpenCV ở $opencvSrc." }

# Từ đây gọi công cụ ngoài (ghi thông báo ra stderr): kiểm tra lỗi bằng $LASTEXITCODE, không bằng Stop.
$ErrorActionPreference = "Continue"
$env:EMSDK_QUIET = "1"
& "$emsdk/emsdk_env.ps1" | Out-Null
$env:EM_CACHE = "$emsdk/upstream/emscripten/cache"
$env:TEMP = "$repo/.tmp"
$env:TMP = $env:TEMP

$simd = if ($NoSimd) { "" } else { "-msimd128" }

# 1. OpenCV tĩnh cho wasm (chỉ core + imgproc, một luồng). Chỉ build lần đầu.
if (-not (Test-Path "$opencv/include/opencv4/opencv2/core.hpp")) {
    emcmake cmake -S $opencvSrc -B $opencvBuild -G Ninja `
        -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$opencv" `
        -DBUILD_LIST="core,imgproc" -DBUILD_SHARED_LIBS=OFF -DENABLE_PIC=OFF `
        -DCPU_BASELINE="" -DCPU_DISPATCH="" -DCV_ENABLE_INTRINSICS="$(if ($NoSimd) {'OFF'} else {'ON'})" `
        -DCMAKE_C_FLAGS="$simd" -DCMAKE_CXX_FLAGS="$simd" `
        -DWITH_PTHREADS_PF=OFF -DOPENCV_DISABLE_THREAD_SUPPORT=ON `
        -DBUILD_TESTS=OFF -DBUILD_PERF_TESTS=OFF -DBUILD_EXAMPLES=OFF -DBUILD_DOCS=OFF -DBUILD_PACKAGE=OFF `
        -DBUILD_opencv_apps=OFF -DBUILD_opencv_js=OFF -DBUILD_JAVA=OFF -DBUILD_opencv_python3=OFF `
        -DWITH_IPP=OFF -DWITH_ITT=OFF -DWITH_OPENCL=OFF -DWITH_EIGEN=OFF -DWITH_LAPACK=OFF -DWITH_ADE=OFF `
        -DWITH_PROTOBUF=OFF -DWITH_TBB=OFF -DWITH_OPENMP=OFF -DWITH_FFMPEG=OFF -DWITH_GSTREAMER=OFF `
        -DWITH_JPEG=OFF -DWITH_PNG=OFF -DWITH_TIFF=OFF -DWITH_WEBP=OFF -DWITH_OPENJPEG=OFF -DWITH_JASPER=OFF `
        -DWITH_OPENEXR=OFF -DWITH_IMGCODEC_HDR=OFF -DWITH_QUIRC=OFF -DWITH_VTK=OFF -DWITH_GTK=OFF `
        -DBUILD_ZLIB=ON -DCV_TRACE=OFF -DOPENCV_GENERATE_PKGCONFIG=OFF -DBUILD_WASM_INTRIN_TESTS=OFF
    if ($LASTEXITCODE -ne 0) { throw "Cấu hình OpenCV wasm thất bại." }
    cmake --build $opencvBuild --parallel
    if ($LASTEXITCODE -ne 0) { throw "Build OpenCV wasm thất bại." }
    cmake --install $opencvBuild
    if ($LASTEXITCODE -ne 0) { throw "Cài OpenCV wasm thất bại." }
}

$libs = @('libopencv_imgproc', 'libopencv_core', 'libzlib') | ForEach-Object {
    $name = $_
    $lib = Get-ChildItem -LiteralPath $opencv -Recurse -Filter "$name*.a" | Select-Object -First 1
    if (-not $lib) { throw "Không tìm thấy $name trong $opencv." }
    $lib.FullName
}

# 2. docdetect_v3 (giữ nguyên mã nguồn Core) + cầu nối scan_api.cpp -> một file JS có wasm bên trong.
New-Item -ItemType Directory -Force "$out/obj" | Out-Null
$sources = @('detect', 'geometry', 'lines', 'quads', 'scoring' | ForEach-Object { "$dd3/src/$_.cpp" }) + "$PSScriptRoot/scan_api.cpp"
$flags = @('-std=c++17', '-O3', '-DNDEBUG', "-I$dd3/include", "-I$dd3/src", "-I$opencv/include/opencv4")
if ($simd) { $flags += $simd }
$objects = foreach ($src in $sources) {
    $obj = "$out/obj/$([IO.Path]::GetFileNameWithoutExtension($src)).o"
    em++ @flags -c $src -o $obj
    if ($LASTEXITCODE -ne 0) { throw "Biên dịch $src thất bại." }
    $obj
}

# Link hai bản từ cùng object: docdetect.js cho WebView (Worker), docdetect.node.js để đối chiếu với native.
$link = @($objects) + $libs + @('-O3', '-sMODULARIZE=1', '-sEXPORT_NAME=createDocDetect', '-sALLOW_MEMORY_GROWTH=1',
    '-sINITIAL_MEMORY=33554432', '-sFILESYSTEM=0',
    '-sEXPORTED_FUNCTIONS=_malloc,_free,_scan_detect,_scan_warp,_scan_result_size',
    '-sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPF32')
if ($simd) { $link += $simd }
em++ @link -sSINGLE_FILE=1 -sSINGLE_FILE_BINARY_ENCODE=0 -sENVIRONMENT=worker -o "$out/docdetect.js"
if ($LASTEXITCODE -ne 0) { throw "Link docdetect.js thất bại." }
em++ @link -sSINGLE_FILE=1 -sSINGLE_FILE_BINARY_ENCODE=0 -sENVIRONMENT=node -o "$out/docdetect.node.js"
if ($LASTEXITCODE -ne 0) { throw "Link docdetect.node.js thất bại." }
Write-Host "Built $out/docdetect.js ($([math]::Round((Get-Item "$out/docdetect.js").Length / 1MB, 2)) MB)"

# 3. Gói lại trang quét (src/scanner/page.generated.ts).
node "$PSScriptRoot/../scripts/build-web.mjs"
if ($LASTEXITCODE -ne 0) { throw "Sinh trang quét thất bại." }
