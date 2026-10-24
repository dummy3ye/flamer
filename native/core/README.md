# Native core

The native core contains optional workers for expensive, isolated operations.
The TypeScript CLI remains the source of truth for findings and report shape.

## Protocol

Workers use newline-delimited JSON on stdin/stdout. Diagnostics must go to
stderr; stdout contains exactly one response for each request.

Requests use protocol version `1`:

```json
{ "protocol": 1, "operation": "file_metrics", "root": ".", "files": ["src/cli.ts"] }
```

The Rust and C++ workers parallelize independent file reads and return byte and
newline counts. Both receive the same request in the default `all` mode. A
native failure falls back to TypeScript in `all` mode and is fatal when a
specific worker is selected.
The workers are helpers, not standalone CLI replacements; the npm-installed
`flamerjs` command remains the user-facing entry point.

The native projects are intentionally real language projects rather than
single-file examples:

- Rust has a reusable library in `rust/src/lib.rs`, a thin JSONL binary in
  `rust/src/main.rs`, Cargo dependency locking, `rustfmt.toml`, `clippy.toml`,
  `deny.toml`, and Cargo build configuration.
- C++ has public declarations in `cpp/include/flamer/core.hpp`, analysis
  implementation in `cpp/src/analyzer.cpp`, a protocol executable in
  `cpp/src/main.cpp`, CMake configuration, `.clangd`, and `.clang-format`.

## npm distribution

Published platform packages contain both workers:

```text
@dummy3ye/flamer-native-<platform>-<arch>/
└── bin/
    ├── flamer-core
    └── flamer-core-cpp
```

The main `flamerjs` package lists these as optional dependencies. npm selects
the package matching the host platform, and the TypeScript adapter discovers
the `rust` and `cpp` export paths automatically. Build a package locally with
`npm run native:package -- linux-x64` after building both workers.

## Rust worker

```bash
cargo build --release --manifest-path native/core/rust/Cargo.toml
printf '%s\n' '{"protocol":1,"operation":"file_metrics","root":".","files":["README.md"]}' \
  | native/core/rust/target/release/flamer-core
```

## C++ worker

```bash
cmake -S native/core/cpp -B native/core/cpp/build -DCMAKE_BUILD_TYPE=Release
cmake --build native/core/cpp/build --config Release
FLAMER_CPP_CORE="$PWD/native/core/cpp/build/flamer-core-cpp" \
  node dist/cli.js . --engine cpp
```
