#!/usr/bin/env sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

if ! command -v cmake >/dev/null 2>&1; then
  echo "C++ native build requires CMake" >&2
  exit 1
fi

cmake -S "$root/native/core/cpp" -B "$root/native/core/cpp/build" -DCMAKE_BUILD_TYPE=Release
cmake --build "$root/native/core/cpp/build" --config Release --parallel
