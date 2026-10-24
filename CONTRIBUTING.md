# Contributing to flamer

Thanks for looking. Flamer is a small Node.js and TypeScript project, so the
workflow is intentionally short.

## Ground rules

- **Findings are factual.** Output guidance lives in `SKILL.md` and nowhere
  else. Analyzers emit severity, title, detail and files. No jokes in
  `detail` fields, ever, because they get pasted into CI logs.
- **Redact credentials.** A finding may name the file and the kind of secret.
  Never echo the value.

## Setup

```bash
npm ci
```

Build and run the checks:

```bash
npm test                       # run the test suite
npm run lint
npm run format:check
npm run build
node dist/cli.js .             # analyze the current repository
```

## Adding a check

1. Write a module in `src/analyzers/` that default-exports or named-exports
   `(ctx) => Finding[]`.
2. Register it in the `ANALYZERS` array in `src/analyzers/index.ts` with a
   unique `id`.
3. Add a focused test in a sibling `*.test.ts` covering a case that must fire
   and a case that must not.

Analyzers run in isolation. If one throws, the others still complete and the
failure is reported in `metadata.analyzers[*].error`. Do not let an analyzer
read files off disk. The tree is walked once by `src/scan.ts` and everything an
analyzer needs is on `ctx`.

## Adding a language

Append one entry to `LANGUAGES` in `src/registry.ts`:

| Field         | What it drives                                                                       |
| ------------- | ------------------------------------------------------------------------------------ |
| `id`, `label` | identity in the report                                                               |
| `exts`        | which files belong to this language                                                  |
| `comment`     | comment syntax, used to parse `TODO` style annotations                               |
| `bloat`       | adaptive line thresholds, so a 600 line generated file is not a 600 line source file |
| `tests`       | patterns that identify this language's test files                                    |

`tests` matters more than it looks. Test coverage is computed per language, so
without a `tests` pattern every test file is counted as source.

## Tests

Every change needs a test that fails without it. Prefer testing behavior
through the public surface (`scanFile`, an analyzer, the CLI) over testing
internals.

```bash
npm test                              # everything
npx vitest run src/scan.test.ts      # one file
npx tsc --noEmit                     # type-checking
```

If a test reports a parse or type error, fix that before interpreting behavioral
failures.

## Pull requests

- One concern per PR.
- Say what you measured. "This is faster" needs a number and a corpus.
- Update the README if you changed the CLI, the file layout, or the counts.
- Keep the test count in the README honest.
