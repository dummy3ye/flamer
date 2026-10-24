cmake_minimum_required(VERSION 3.16)
project(flamer_core_cpp LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

add_executable(flamer-core-cpp src/main.cpp src/analyzer.cpp)
target_include_directories(flamer-core-cpp PRIVATE include)
if(MSVC)
  target_compile_options(flamer-core-cpp PRIVATE /W4 /permissive-)
else()
  target_compile_options(flamer-core-cpp PRIVATE -Wall -Wextra -Wpedantic)
endif()

include(CTest)
if(BUILD_TESTING)
  add_test(
    NAME cpp_protocol_smoke
    COMMAND sh -c
      "printf '%s\\n' '{\"protocol\":1,\"operation\":\"cpp_analysis\",\"root\":\"${CMAKE_SOURCE_DIR}/../../..\",\"files\":[\"native/core/cpp/src/main.cpp\"]}' | $<TARGET_FILE:flamer-core-cpp> >/dev/null"
  )
endif()
