cmake_minimum_required(VERSION 3.16)
project(docdetect LANGUAGES CXX)

# Thư viện detect tài liệu (v2). Chỉ cần OpenCV core + imgproc.
#   Windows (server):  cmake -B build -G Ninja -DOpenCV_DIR=<opencv>/x64/mingw/staticlib && cmake --build build
#   Android:           thêm add_subdirectory(native/docdetect) trong CMake của app, OpenCV_DIR = OpenCV-android-sdk/sdk/native/jni
#   iOS:               build tĩnh (STATIC) cùng opencv2.framework

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

option(DOCDETECT_SHARED "Build thư viện động (cho Python ctypes)" ON)

# OPENCV_STATIC_ROOT: thư mục cài OpenCV tĩnh do build.ps1 tạo (link thẳng các .a, tránh OpenCVConfig
# đòi các thư viện ảnh đã tắt). Không đặt thì dùng find_package như bình thường (Android/iOS).
set(OPENCV_STATIC_ROOT "" CACHE PATH "Thư mục cài OpenCV tĩnh (MinGW)")
if(OPENCV_STATIC_ROOT)
  file(GLOB OCV_LIBDIR LIST_DIRECTORIES true "${OPENCV_STATIC_ROOT}/x64/*/staticlib")
  file(GLOB OCV_IMGPROC "${OCV_LIBDIR}/libopencv_imgproc*.a")
  file(GLOB OCV_CORE "${OCV_LIBDIR}/libopencv_core*.a")
  file(GLOB OCV_ZLIB "${OCV_LIBDIR}/libzlib.a")
  set(OpenCV_INCLUDE_DIRS "${OPENCV_STATIC_ROOT}/include")
  set(OCV_LIBS ${OCV_IMGPROC} ${OCV_CORE} ${OCV_ZLIB})
else()
  find_package(OpenCV REQUIRED COMPONENTS core imgproc)
  set(OCV_LIBS opencv_imgproc opencv_core)
endif()

set(SOURCES src/detect.cpp src/geometry.cpp src/lines.cpp src/quads.cpp src/scoring.cpp)
if(DOCDETECT_SHARED)
  add_library(docdetect SHARED ${SOURCES})
else()
  add_library(docdetect STATIC ${SOURCES})
endif()

target_include_directories(docdetect PUBLIC include PRIVATE src ${OpenCV_INCLUDE_DIRS})
target_link_libraries(docdetect PRIVATE ${OCV_LIBS})
set_target_properties(docdetect PROPERTIES CXX_VISIBILITY_PRESET hidden PREFIX "")

if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
  target_compile_options(docdetect PRIVATE -O3 -Wall)
  if(MINGW)
    # Gói sẵn runtime C++ vào DLL để Python nạp được mà không cần DLL của MinGW.
    target_link_options(docdetect PRIVATE -static -static-libgcc -static-libstdc++)
  endif()
endif()
