cmake_minimum_required(VERSION 3.16)
project(flamer_core_cpp LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_executable(flamer-core-cpp src/main.cpp)
target_compile_options(flamer-core-cpp PRIVATE -Wall -Wextra -Wpedantic)
