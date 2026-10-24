#!/usr/bin/env sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

if ! command -v cargo >/dev/null 2>&1; then
  echo "native build requires Cargo (install Rust from https://rustup.rs)" >&2
  exit 1
fi

if ! command -v cmake >/dev/null 2>&1; then
  echo "native build requires CMake" >&2
  exit 1
fi

cargo build --release --manifest-path "$root/native/core/rust/Cargo.toml"
cmake -S "$root/native/core/cpp" -B "$root/native/core/cpp/build" -DCMAKE_BUILD_TYPE=Release
cmake --build "$root/native/core/cpp/build" --config Release --parallel
