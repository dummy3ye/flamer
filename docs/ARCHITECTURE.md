# Flamer architecture

Flamer is a Node.js CLI with an optional native execution layer. TypeScript
owns the public interface, repository traversal, analyzers, findings, and
report format. Native workers provide isolated, opt-in performance helpers and
must never silently change the meaning of a report.

## Runtime layers

```text
CLI (src/cli.ts)
  ├─ argument parsing and terminal/JSON output
  ├─ repository detection and scope selection
  ├─ TypeScript scanner and analyzers
  └─ optional native metrics adapter (src/native.ts)
       ├─ Rust worker: native/core/rust
       └─ C++ worker: native/core/cpp
```

### TypeScript layer

The TypeScript CLI is the default and source of truth. `src/scan.ts` walks and
reads files once, `src/detect.ts` builds project profiles, and registered
analyzers turn the collected context into findings. This path works with the
published npm package and does not require Rust, C++, Cargo, or CMake.

### Native layer

The native layer currently computes file metrics: readable file count, byte
count, and newline count. It is intentionally separate from analyzer logic so
native failures cannot produce different findings or bypass redaction rules.

Rust is the primary worker and is built from
`native/core/rust/Cargo.toml`. The C++ worker is a protocol-compatible
alternative built with CMake from `native/core/cpp/CMakeLists.txt`.

## Engine selection

The CLI accepts:

| Engine       | Behavior                                                      |
| ------------ | ------------------------------------------------------------- |
| `typescript` | Default; never starts a native process.                       |
| `native`     | Requires a native worker and exits with an error if it fails. |
| `auto`       | Attempts the native worker and falls back to TypeScript.      |

Native mode is selected with `--engine native`. The worker can be overridden
with the `FLAMER_CORE` environment variable, which is useful for selecting the
C++ implementation:

```bash
FLAMER_CORE="$PWD/native/core/cpp/build/flamer-core-cpp" \
  node dist/cli.js . --engine native
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
layer, packages the Rust worker as the default native engine, and may include
the C++ worker as a platform-specific alternative. The current workers are not
standalone CLI replacements and are not loaded simultaneously.

## Design constraints

- Keep the default npm installation dependency-free beyond Node.js.
- Keep findings and report semantics in TypeScript.
- Keep workers deterministic and communicate only through the versioned
  protocol.
- Make native execution opt-in until platform packaging and fallback behavior
  are mature.
- Add a benchmark before moving more work out of the TypeScript scanner.
