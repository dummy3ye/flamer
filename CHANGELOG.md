# Changelog

All notable changes to flamer are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.1.0] - 2026-10-02

First public release.

### Added

- Single-pass tree scanner covering 25 languages across 70 file extensions:
  JavaScript, TypeScript, Python, Rust, Go, C, C++, C#, Java, Kotlin, Scala,
  Terraform, HCL, Docker, SQL, Ruby, PHP, Shell, PowerShell, Haskell, Elixir,
  Lua, R, Solidity, Swift, Dart, Zig, and Jupyter notebooks.
- Eight analyzers, each isolated so one throwing does not stop the rest:
  `universal`, `notebooks`, `scaffolding`, `testing`, `git`, `node`, `python`,
  `systems`.
- Redacted credential detection for 14 credential shapes, with test and fixture
  paths exempt so a repository's own fake secrets are not reported.
- Adaptive bloat detection with per-language baselines, so a large generated
  file is not scored as though a human wrote every line.
- Per-language test coverage ratios, so a mostly-Terraform repository is not
  graded as though it were all application code.
- The roast persona in `SKILL.md`, including a confirmation gate, an audit mode
  that drops the character, and an instruction to defer deep security analysis
  to the `poison` skill when it is installed.
- JSON output by default with a human-readable `--format summary`.

### Performance

Measured on a 3.0 GB monorepo of 98,161 files, 71,150 of them source:
**3.60s before, 2.10s after**, with byte-identical findings.

- Newline discovery uses `indexOf` rather than a per-character `charCodeAt`
  loop. Measured 3.7x faster on a 525 MB corpus; `split` measured slower than
  both while also allocating an array of every line.
- The credential scanner gates 13 of its 14 patterns behind a literal substring
  test, so the regex engine never runs against a file that cannot contain that
  shape of credential. The assignment pattern is intentionally left ungated
  because its names match case insensitively and an incomplete gate would be a
  silently dropped rule.
- Line numbers for a credential finding are resolved by binary search over a
  lazily built offset table. The previous approach sliced and split the text
  once per match, which is up to 280 times on a single file.

### Notes

- Zero runtime dependencies. Node 18 or newer, no install step.
- `poison` is a separate project. Flamer does not import it, and the handoff is
  a runtime capability check in `SKILL.md` rather than a code dependency.

[Unreleased]: https://github.com/OWNER/flamer/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/OWNER/flamer/releases/tag/v0.1.0
