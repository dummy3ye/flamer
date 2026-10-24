#!/usr/bin/env sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

if ! command -v cargo >/dev/null 2>&1; then
  echo "native tests require Cargo (install Rust from https://rustup.rs)" >&2
  exit 1
fi

if ! command -v cmake >/dev/null 2>&1; then
  echo "native tests require CMake" >&2
  exit 1
fi

printf '%s\n' '==> Testing Rust native worker'
cargo test --manifest-path "$root/native/core/rust/Cargo.toml"

printf '%s\n' '==> Testing C++ native worker'
cmake -S "$root/native/core/cpp" -B "$root/native/core/cpp/build" -DCMAKE_BUILD_TYPE=Debug
cmake --build "$root/native/core/cpp/build" --config Debug --parallel

printf '%s\n' '{"protocol":1,"operation":"cpp_analysis","root":".","files":["native/core/cpp/src/main.cpp"]}' |
  "$root/native/core/cpp/build/flamer-core-cpp" >/dev/null

printf '%s\n' '==> Native worker tests passed'
