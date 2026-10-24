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
newline counts. A native failure is
reported by the CLI in `auto` mode and is fatal in explicit `native` mode.
The workers are helpers, not standalone CLI replacements; the npm-installed
`flamerjs` command remains the user-facing entry point.

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
FLAMER_CORE="$PWD/native/core/cpp/build/flamer-core-cpp" \
  node dist/cli.js . --engine native
```
