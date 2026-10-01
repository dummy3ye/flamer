# flamer

A language-agnostic code health auditor. Walks a repository once, runs every
registered analyzer, and prints a JSON report of what's wrong with it.

Works on any repo layout (single package, monorepo, or polyglot) and on 25
languages across 70 file extensions. Zero dependencies; Node's standard library
only.

```
flamer/
├── flamer.mjs          entry point: args, orchestration, output
├── lib/
│   ├── registry.mjs    the 25 language profiles, start here to add one
│   ├── detect.mjs      layout + ecosystem detection
│   ├── scan.mjs        single-pass file scanner
│   ├── util/           fs, git, findings helpers
│   └── analyzers/      8 isolated check suites
├── test/               173 tests (node --test)
├── docs/SPEC.md        the report contract shared with poison
├── SKILL.md            the roast persona that consumes the JSON
├── CONTRIBUTING.md     how to add a language or a check
└── CHANGELOG.md
```

## Requirements

Node 18 or newer. No install step, no `package.json`, no dependencies.

## Usage

```bash
node flamer.mjs                 # analyze the current directory
node flamer.mjs /path/to/repo   # analyze somewhere else
```

### Options

| Flag | Purpose |
|---|---|
| *(positional path)* | repo to analyze; defaults to cwd |
| `--package <name>`, `--scope <name>` | analyze one sub-project of a monorepo |
| `--format summary` | human-readable summary to stderr instead of JSON |
| `--out <file>` | also write the JSON report to a file |
| `--fail-on <SEVERITY>` | exit 1 if any finding is at/above this severity |
| `--no-git` | skip git history analysis (faster; for non-repos) |
| `--no-lockfile-warning` | suppress the "no lockfile" suggestion |
| `--ignore-dir <name>` | additionally skip a directory name (repeatable) |
| `--max-files <n>` | stop walking after n files (default 60000) |
| `--commit-limit <n>` | how many commits to inspect (default 1000) |
| `--list-languages` | print the supported language table |
| `--help` | full option list |

**Exit codes:** `0` normal · `1` `--fail-on` tripped · `2` path not found

## Supported languages

JavaScript, TypeScript, Python, Rust, Go, C, C++, C#, Java/Kotlin/Scala,
Terraform/HCL, Docker, SQL, Ruby, PHP, Shell, PowerShell, Haskell, Elixir, Lua,
R, Solidity, Swift, Dart, Zig, and Jupyter notebooks.

```bash
node flamer.mjs --list-languages   # full table with extensions
```

## What it checks

**Any language**: exposed credentials (redacted in the output), unresolved
merge-conflict markers, adaptive file bloat, empty and stub files, work-item
annotations in comments, overlong lines, mixed line endings, missing trailing
newlines, excessive path depth, vendored or generated code in the tree, missing
shebangs.

**Per ecosystem**: dependency version drift across packages, missing
build/test/lint/typecheck scripts, wildcard and loosely-pinned versions,
lockfile presence, Rust `unwrap()` density, Go discarded errors, C# nullable
settings, unpinned Python requirements, `SELECT *`, and missing lockfiles and
version pins across the smaller ecosystems.

### What flamer does not check

Deep security analysis belongs to the **poison** skill, which is a separate and
independently installable scanner. Injection, weak cryptography, disabled TLS,
insecure infrastructure as code, unsafe container and cluster configuration,
and dependency supply chain risk are all poison's territory.

Flamer keeps a credential scanner on purpose: a leaked key is the one security
finding a roast must never miss, and the detector is cheap and language
agnostic. Everything deeper is delegated.

Test coverage is computed **per language**, so a mostly-Terraform repo is not
graded as though it were all application code.

## Output

```jsonc
{
  "version": 2,
  "project": {
    "name": "myrepo",
    "kind": ["node", "python"],
    "layout": "monorepo",
    "languages": [{ "id": "typescript", "label": "TypeScript" }],
    "dominantLanguage": "typescript",
    "packages": ["root", "api", "web"],
    "totalFiles": 1234,
    "totalSourceFiles": 980,
    "totalLines": 45120
  },
  "findings": [
    {
      "category": "secrets",      // security|deps|testing|bloat|hygiene|secrets|
                                  // markers|vcs|config|build|script|structure|git|error
      "severity": "CRITICAL",     // CRITICAL|HIGH|MEDIUM|LOW|INFO
      "title": "Possible AWS access key id committed to the repository",
      "detail": "Found in 2 file(s). Values are redacted in this report.",
      "files": ["src/app.ts"],
      "count": 2,
      "lang": "typescript"
    }
  ],
  "metadata": {
    "durationSeconds": 0.9,
    "truncated": false,
    "severities": { "CRITICAL": 2, "HIGH": 5, "LOW": 11 },
    "worst": "CRITICAL",
    "analyzers": [{ "id": "universal", "ms": 30, "findings": 12, "error": null }]
  }
}
```

Findings arrive sorted worst-first. If `metadata.analyzers[*].error` is
non-null, that analyzer crashed and its area should be treated as unknown
rather than clean.

Credential values are **always redacted**. The analyzer will not echo a secret
into its own output.

## In CI

```bash
node flamer.mjs . --fail-on CRITICAL   # fail the build on anything critical
node flamer.mjs . --out report.json    # keep the full report as an artifact
```

## Relationship to poison

`poison` is a separate skill and a separate project. It does not import
flamer, and flamer does not import poison.

Flamer's `SKILL.md` tells the agent to look for an available skill with the ID
`poison` before roasting. If it is installed, flamer loads it and uses its
report as the security section. If it is not, flamer says security coverage is
limited to leaked credentials. That check is a runtime capability lookup, so
both skills stay independently distributable.

## Extending it

**Add a language:** append one entry to `LANGUAGES` in `lib/registry.mjs`. Give
it extensions, a comment spec (used to parse annotations), bloat baselines, and
test-file patterns. That is usually all that is needed for the universal checks
to start working on it.

**Add a check:** write a module in `lib/analyzers/` exporting
`(ctx) => Finding[]`, then add it to the `ANALYZERS` array in
`lib/analyzers/index.mjs`. Analyzers run in isolation: if one throws, the rest
still complete and the failure is reported in the output.

`ctx` carries the walked file records, the detected profile, the git-tracked
path set, and CLI options. No analyzer re-reads files: the tree is walked once
and content-derived metrics are computed during that single pass.

## Performance

One tree walk, one read per file, contents never retained. Measured on a 3.0 GB
monorepo of 98,161 files, 71,150 of them source, spanning Go, Node, Python,
Terraform and Docker: **2.1 seconds**, 52 findings.

The cost is content, not syscalls. The tree walk is 152ms and git is 44ms; the
rest is reading 223 MB and counting lines. Two things dominate and both are
addressed in `lib/scan.mjs`:

- Newlines are found with `indexOf` rather than a per-character loop. Measured
  3.7x faster on a 525 MB corpus. `split` was slower than both while also
  allocating an array of every line.
- The secret scanner gates 13 of its 14 patterns behind a literal substring
  test, so the regex engine never runs on a file that cannot contain that shape
  of credential. The assignment pattern is deliberately left ungated: its names
  match case insensitively, and an incomplete gate would silently drop a rule.

`--max-files` bounds the walk on very large repositories, and
`metadata.truncated` tells you when the cap was hit.

## Tests

```bash
node --test                    # all 173
node --test lib/scan.test.mjs  # one file
```

## License

MIT. See [LICENSE](LICENSE).
