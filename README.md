# Flamer

**A fast sanity checker for AI-assisted codebases.**

[![CI](https://img.shields.io/github/actions/workflow/status/dummy3ye/flamer/ci.yml?branch=master&style=for-the-badge&label=CI&labelColor=101418&color=9ccbfb)](https://github.com/dummy3ye/flamer/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/codecov/c/github/dummy3ye/flamer?style=for-the-badge&label=coverage&labelColor=101418&color=b9c8da)](https://codecov.io/gh/dummy3ye/flamer)
[![npm](https://img.shields.io/npm/v/flamerjs?style=for-the-badge&labelColor=101418&color=d3bfe6)](https://www.npmjs.com/package/flamerjs)<br>
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge&labelColor=101418&color=d3bfe6)](LICENSE)
[![GitHub last commit](https://img.shields.io/github/last-commit/dummy3ye/flamer?style=for-the-badge&labelColor=101418&color=9ccbfb)](https://github.com/dummy3ye/flamer/commits/master)
[![GitHub Repo stars](https://img.shields.io/github/stars/dummy3ye/flamer?style=for-the-badge&labelColor=101418&color=b9c8da)](https://github.com/dummy3ye/flamer/stargazers)
[![GitHub repo size](https://img.shields.io/github/repo-size/dummy3ye/flamer?style=for-the-badge&labelColor=101418&color=d3bfe6)](https://github.com/dummy3ye/flamer)

Flamer scans a repository for the common mistakes that appear when software is
assembled quickly with AI or other “vibe coding” workflows: unfinished
implementation, broken project wiring, missing tests, inconsistent tooling,
repository hygiene problems, and maintainability traps.

It is designed to answer:

> **What is obviously unfinished, disconnected, inconsistent, or likely to
> break in this repository?**

Flamer is **not a deep security scanner**. It includes a small credential check
so accidentally committed keys are not ignored; injection, authentication,
cryptography, infrastructure security, and supply-chain analysis belong in a
dedicated security tool.

## Why Flamer?

AI-generated code can look complete while still containing:

- placeholder implementations and empty error handlers;
- routes, scripts, or configuration that do not connect;
- tests that exist but provide little confidence;
- duplicate, generated, oversized, or abandoned files;
- dependency and runtime configuration that differs between environments.

Flamer turns these signals into a prioritized, machine-readable report that
can be used locally, in pull requests, or in CI.

## Features

- **Unfinished implementation:** explicit “not implemented” paths and empty
  error handlers.
- **Project health:** missing README, license, CI, environment templates,
  editor configuration, and ecosystem scaffolding.
- **Testing signals:** test presence and source-to-test balance by language.
- **Dependency hygiene:** lockfiles, version constraints, and manifest checks.
- **Repository hygiene:** conflict markers, work-item markers, missing
  newlines, mixed line endings, generated/vendor bloat, and deep paths.
- **Language-aware checks:** JavaScript/TypeScript, Python, Rust, Go, C/C++,
  C#, Zig, SQL, notebooks, and additional language profiles.
- **Stable JSON output:** suitable for CI annotations and other automation.
- **Single-pass TypeScript scanning:** the repository is walked once and
  content is collected once before analyzers run.
- **Coordinated native workers:** Rust handles shared file metrics and
  Rust-specific checks, while C++ handles C/C++ checks; TypeScript remains the
  source of truth and fallback path.

## Requirements

- Node.js 18 or newer
- npm

The default TypeScript engine needs only Node.js and npm. Building native
workers from this repository additionally requires Rust/Cargo and a C++17
compiler with CMake. Published npm installs use TypeScript unless a compatible
native worker has been built or supplied explicitly.

## Quick start

Run the published CLI without installing it permanently:

```bash
npx flamerjs .
```

For a project-local installation, add Flamer as a development dependency:

```bash
npm install --save-dev flamerjs
npx flamerjs .
```

Or install it globally if you use it across repositories:

```bash
npm install --global flamerjs
flamerjs .
```

The default output is a colorized terminal summary when run interactively.
Use `--format json` for automation and machine-readable output.

For a human-readable report:

```bash
flamerjs . --format summary
```

Analyze another repository:

```bash
flamerjs /path/to/repository --format summary
```

## CLI

```text
flamerjs [path] [options]
```

| Option                                  | Description                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| `--package, --scope <name>`             | Analyze only a named sub-project                                              |
| `--path <dir>`                          | Set the repository root; defaults to the current directory                    |
| `--format <json\|summary>`              | Select JSON or human-readable output; summary is the default                  |
| `--out <file>`                          | Also write the JSON report to a file                                          |
| `--fail-on <SEVERITY>`                  | Exit with status 1 at or above `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, or `INFO` |
| `--max-files <n>`                       | Limit the number of files scanned                                             |
| `--commit-limit <n>`                    | Limit commits inspected by Git checks                                         |
| `--no-git`                              | Skip Git analysis                                                             |
| `--no-lockfile-warning`                 | Suppress the missing-lockfile suggestion                                      |
| `--ignore-dir <name>`                   | Ignore an additional directory name; repeatable                               |
| `--quiet`                               | Suppress the human summary                                                    |
| `--color`                               | Force ANSI colors                                                             |
| `--no-color`                            | Disable ANSI colors                                                           |
| `--engine <all\|typescript\|rust\|cpp>` | Run all engines (default) or select one engine                                |
| `--list-languages`                      | List recognized language profiles                                             |
| `--help`                                | Show command help                                                             |

Exit status `0` means the scan completed; findings may still exist. Status `1`
means `--fail-on` was reached, and status `2` indicates invalid usage or a
missing path.

## Example report

```json
{
  "project": {
    "name": "example-app",
    "kind": ["node"],
    "layout": "single"
  },
  "findings": [
    {
      "category": "unfinished",
      "severity": "HIGH",
      "title": "2 source file(s) contain unfinished implementation",
      "detail": "Not-implemented errors and empty error handlers were detected.",
      "files": ["src/api.ts", "src/jobs.ts"],
      "count": 2
    }
  ]
}
```

Findings are sorted by severity. Credential values are always redacted.

## Development

Clone the repository when you want to contribute or work on the scanner itself:

```bash
npm ci
npm run dev             # watch and rebuild dist/cli.js
npm test                # run the test suite
npm run lint
npm run format:check
npm run build
```

To run the local build directly:

```bash
node dist/cli.js .
```

The project uses Node.js and npm as its supported development toolchain.
`package-lock.json` is the canonical dependency lockfile.
The current test suite contains **175 tests**.

### Native engine

Flamer runs all three components by default: TypeScript analyzers plus the Rust
and C++ native workers. They do different work and run concurrently:

- TypeScript walks the repository, runs the generic analyzers, and produces the
  report.
- Rust computes shared metrics for all selected files and checks Rust files for
  `.unwrap()` usage.
- C++ checks only C and C++ files for native-language issues such as
  `#include <bits/stdc++.h>`.

```bash
npm run native:build:all
node dist/cli.js .
```

Native findings are merged into the TypeScript report only after all requested
native jobs succeed. If a native binary is unavailable or fails, the default
`all` mode falls back to a pure TypeScript report. Use `--engine typescript` for
a native-free scan, or `--engine rust` / `--engine cpp` to require one specific
worker; explicit native modes return an error when their worker fails.
The native protocol and worker details are documented in
[`native/core/README.md`](native/core/README.md).

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the runtime layers,
worker protocol, engine selection, and native development workflow.

For the source installation path:

```bash
curl -fsSL https://raw.githubusercontent.com/dummy3ye/flamer/master/scripts/install.sh | sh
```

Platform-specific native release binaries are not bundled in the current npm
package yet. The installer's `native` path is reserved for releases that attach
those assets; until then, use the npm package or build the workers locally.

## How it works

1. Detect the repository layout, languages, and ecosystems.
2. Walk the tree once and collect file metadata and content-derived signals.
3. Run isolated analyzers against the collected records.
4. Run the requested native jobs through the versioned JSONL protocol. Native
   jobs receive non-overlapping responsibilities and return metrics or
   language-specific findings.
5. Merge successful native findings, sort everything, and emit JSON or a
   concise summary. In default `all` mode, any native failure returns to the
   TypeScript-only result.

Analyzers are intentionally factual and conservative. A finding should identify
something actionable rather than merely express a preference.

## Scope and non-goals

Flamer focuses on **codebase completeness and engineering health**, not
penetration testing. It does not attempt to prove that an application is
secure, correct, performant, or production-ready. Static signals always need
human review, especially when a project uses deliberate stubs, generated code,
or unusual architecture.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and
guidelines for adding analyzers, language profiles, and tests.

When adding a check:

1. Prefer a high-confidence signal with a concrete fix.
2. Add a focused regression test.
3. Keep false positives low and explain unavoidable uncertainty.
4. Update the README when user-visible behavior changes.

## License

This project is licensed under the [MIT License](LICENSE).
