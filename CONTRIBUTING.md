# Contributing to flamer

Thanks for looking. This is a small, dependency-free Node project, so the
workflow is short.

## Ground rules

- **Zero dependencies.** Node's standard library only. Do not add a
  `package.json` dependency. If something needs a library, it probably needs a
  different design.
- **No `package.json`.** There isn't one and there shouldn't be one. It is
  invoked as `node flamer.mjs`.
- **Findings are factual.** The roast persona lives in `SKILL.md` and nowhere
  else. Analyzers emit severity, title, detail and files. No jokes in
  `detail` fields, ever, because they get pasted into CI logs.
- **Redact credentials.** A finding may name the file and the kind of secret.
  Never echo the value.

## Setup

Nothing to install.

```bash
node --test                    # 173 tests
node flamer.mjs .              # analyze yourself, which is humbling
```

## Adding a check

1. Write a module in `lib/analyzers/` that default-exports or named-exports
   `(ctx) => Finding[]`.
2. Register it in the `ANALYZERS` array in `lib/analyzers/index.mjs` with a
   unique `id`.
3. Add tests in a sibling `*.test.mjs` covering a case that must fire and a case
   that must not.

Analyzers run in isolation. If one throws, the others still complete and the
failure is reported in `metadata.analyzers[*].error`. Do not let an analyzer
read files off disk. The tree is walked once by `lib/scan.mjs` and everything an
analyzer needs is on `ctx`.

## Adding a language

Append one entry to `LANGUAGES` in `lib/registry.mjs`:

| Field | What it drives |
|---|---|
| `id`, `label` | identity in the report |
| `exts` | which files belong to this language |
| `comment` | comment syntax, used to parse `TODO` style annotations |
| `bloatBaselines` | adaptive line thresholds, so a 600 line generated file is not a 600 line source file |
| `tests` | patterns that identify this language's test files |

`tests` matters more than it looks. Test coverage is computed per language, so
without a `tests` pattern every test file is counted as source.

## Tests

Every change needs a test that fails without it. Prefer testing behavior
through the public surface (`scanFile`, an analyzer, the CLI) over testing
internals.

```bash
node --test                          # everything
node --test lib/scan.test.mjs        # one file
node --check lib/whatever.mjs        # syntax only
```

If `node --test` reports a file simply as "test failed" with no useful message,
that file does not parse. `node --check` will tell you which line.

## Pull requests

- One concern per PR.
- Say what you measured. "This is faster" needs a number and a corpus.
- Update the README if you changed the CLI, the file layout, or the counts.
- Keep the test count in the README honest.
