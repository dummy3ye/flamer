# Flamer architecture

Flamer is a Node.js CLI with a coordinated native execution layer. TypeScript
owns the public interface, repository traversal, generic analyzers, findings,
fallback behavior, and report format. Rust and C++ run together as specialized
workers with non-overlapping responsibilities. Native findings are validated
and merged into the TypeScript report; they are not alternative scanners.

## Runtime layers

```text
CLI (src/cli.ts)
  ├─ argument parsing and terminal/JSON output
  ├─ repository detection and scope selection
  ├─ TypeScript scanner and analyzers
  └─ native worker adapter (src/native.ts)
       ├─ Rust worker: native/core/rust
       │    ├─ shared file metrics
       │    └─ Rust-specific analysis
       └─ C++ worker: native/core/cpp
            └─ C/C++-specific analysis
```

### TypeScript layer

The TypeScript CLI is the default and source of truth. `src/scan.ts` walks and
reads files once, `src/detect.ts` builds project profiles, and registered
analyzers turn the collected context into findings. This path works with the
published npm package and does not require Rust, C++, Cargo, or CMake.

### Native layer

The native layer is intentionally separate from generic analyzer logic. Rust
receives all selected files for shared byte/newline metrics and receives Rust
files for Rust-specific checks. C++ receives only C and C++ files for
C/C++-specific checks. These jobs run concurrently in `all` mode, so no worker
repeats another worker's language analysis.

Rust is built from `native/core/rust/Cargo.toml` and exposes a reusable library
plus a thin JSONL binary. C++ is built with CMake from
`native/core/cpp/CMakeLists.txt` and exposes a public header, analyzer
implementation, and protocol executable.

The current native checks are deliberately small but real: Rust reports
`.unwrap()` usage and C++ reports the non-portable
`#include <bits/stdc++.h>` include. Additional expensive, language-specific
work can be added without moving report ownership out of TypeScript.

## Engine selection

The CLI accepts:

| Engine       | Behavior                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `all`        | Default; runs TypeScript, Rust, and C++ together. Falls back to the TypeScript-only report if any native job is unavailable or fails. |
| `typescript` | Runs only the TypeScript implementation.                                                                                              |
| `rust`       | Runs TypeScript plus Rust metrics and Rust analysis; fails if Rust is unavailable.                                                    |
| `cpp`        | Runs TypeScript plus C++ analysis; fails if C++ is unavailable.                                                                       |

The workers can be overridden with `FLAMER_RUST_CORE` and `FLAMER_CPP_CORE`:

```bash
FLAMER_RUST_CORE="$PWD/native/core/rust/target/release/flamer-core" \
FLAMER_CPP_CORE="$PWD/native/core/cpp/build/flamer-core-cpp" \
  node dist/cli.js .
```

## Worker protocol

Workers communicate over newline-delimited JSON (JSONL):

```json
{ "protocol": 1, "operation": "file_metrics", "root": ".", "files": ["README.md"] }
```

Each request produces exactly one response on stdout. The operation determines
the worker contract:

| Worker | Operation       | Input files        | Responsibility                           |
| ------ | --------------- | ------------------ | ---------------------------------------- |
| Rust   | `file_metrics`  | all selected files | byte, newline, and readable-file metrics |
| Rust   | `rust_analysis` | Rust files         | Rust-specific findings                   |
| C++    | `cpp_analysis`  | C/C++ files        | C/C++-specific findings                  |

Example response:

```json
{
  "protocol": 1,
  "ok": true,
  "operation": "file_metrics",
  "metrics": { "files": 1, "bytes": 1234, "lines": 42 },
  "errors": [],
  "duration_ms": 1
}
```

Stdout is reserved for protocol messages. Diagnostics belong on stderr.
Unknown protocol versions, operations, malformed responses, non-zero exits, and
timeouts are errors. The TypeScript adapter validates the response before using
it.

## Build and test

```bash
npm test
npm run native:build
npm run native:test
```

The individual projects can also be built directly:

```bash
cargo build --release --manifest-path native/core/rust/Cargo.toml
cmake -S native/core/cpp -B native/core/cpp/build -DCMAKE_BUILD_TYPE=Release
cmake --build native/core/cpp/build --config Release
```

The npm native scripts validate that Cargo and CMake are installed and return
an actionable error when either toolchain is missing. The C++ CMake project
also exports `compile_commands.json` and contains a protocol smoke test.

Native builds are checked independently in the Native Rust and Native C++
GitHub Actions workflows. Compiled output is ignored and is not committed.

## Release and installation roadmap

The npm package remains the required, portable installation:

```bash
npm install --global flamerjs
```

The planned native distribution publishes both workers for each supported
OS/architecture. `scripts/install.sh native` will select matching Rust and C++
assets, while npm remains the fallback for unsupported platforms. The release
workflow must build, name, checksum, and attach both workers for Linux, macOS,
and Windows before native installation is advertised as generally available.
Until those assets exist, native workers are source-build artifacts rather than
part of the published npm package.

The eventual bundled release keeps the TypeScript CLI as the orchestration
layer and packages both Rust and C++ workers. They are not alternatives:
standard execution starts both, while the explicit engine flags are for
debugging, benchmarking, and degraded environments.

## Design constraints

- Keep the default npm installation dependency-free beyond Node.js.
- Keep findings and report semantics in TypeScript.
- Keep workers deterministic and communicate only through the versioned
  protocol; stdout is protocol-only and diagnostics use stderr.
- Keep native execution fallback-safe until platform packaging and release
  binaries are mature.
- Do not duplicate generic analyzer work in native workers.
- Add a benchmark before moving more work out of the TypeScript scanner.
