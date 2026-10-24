# Flamer architecture

Flamer is a Node.js CLI with a coordinated native execution layer. TypeScript
owns the public interface, repository traversal, analyzers, findings, and
report format. Rust and C++ run together as native preprocessing workers for
the same file set; their metrics enrich the report but never change findings.

## Runtime layers

```text
CLI (src/cli.ts)
  ├─ argument parsing and terminal/JSON output
  ├─ repository detection and scope selection
  ├─ TypeScript scanner and analyzers
  └─ native metrics adapter (src/native.ts)
       ├─ Rust worker: native/core/rust
       └─ C++ worker: native/core/cpp
```

### TypeScript layer

The TypeScript CLI is the default and source of truth. `src/scan.ts` walks and
reads files once, `src/detect.ts` builds project profiles, and registered
analyzers turn the collected context into findings. This path works with the
published npm package and does not require Rust, C++, Cargo, or CMake.

### Native layer

The native layer computes file metrics: readable file count, byte count, and
newline count. Rust and C++ receive the same file list and run together in the
default `all` mode. It is intentionally separate from analyzer logic so native
failures cannot produce different findings or bypass redaction rules.

Rust is the shared metrics and Rust-analysis worker and is built from
`native/core/rust/Cargo.toml`. The C++ worker owns C/C++-specific checks and is
built with CMake from `native/core/cpp/CMakeLists.txt`.

## Engine selection

The CLI accepts:

| Engine       | Behavior                                                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `all`        | Default; runs TypeScript, Rust, and C++ together. Falls back to pure TypeScript if either native worker is unavailable or fails. |
| `typescript` | Runs only the TypeScript implementation.                                                                                         |
| `rust`       | Runs TypeScript plus Rust; fails if Rust is unavailable.                                                                         |
| `cpp`        | Runs TypeScript plus C++; fails if C++ is unavailable.                                                                           |

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

Each request produces exactly one response on stdout:

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

cmake -S native/core/cpp -B native/core/cpp/build -DCMAKE_BUILD_TYPE=Release
cmake --build native/core/cpp/build --config Release
```

Native builds are checked independently in the Native Rust and Native C++
GitHub Actions workflows. Compiled output is ignored and is not committed.

## Release and installation roadmap

The npm package remains the required, portable installation:

```bash
npm install --global flamerjs
```

The planned native distribution publishes one worker per supported
OS/architecture. `scripts/install.sh native` selects the matching Rust worker
asset, while npm remains the fallback for unsupported platforms. The release
workflow must build, name, checksum, and attach Linux, macOS, and Windows
worker artifacts before native installation is advertised as generally
available.

The eventual bundled release keeps the TypeScript CLI as the orchestration
layer and packages both Rust and C++ workers. They are not alternatives:
standard execution starts both, while the explicit engine flags are for
debugging, benchmarking, and degraded environments.

## Design constraints

- Keep the default npm installation dependency-free beyond Node.js.
- Keep findings and report semantics in TypeScript.
- Keep workers deterministic and communicate only through the versioned
  protocol.
- Keep native execution fallback-safe until platform packaging and release
  binaries are mature.
- Add a benchmark before moving more work out of the TypeScript scanner.
