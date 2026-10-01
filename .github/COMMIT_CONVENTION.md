# Commit convention

Conventional Commits, enforced by `commitlint` in CI once the workflow is wired
up. Until then, follow it by hand.

```
<type>(<scope>): <subject>

<body>

<footer>
```

## Types

| Type | Use for | Version bump |
|---|---|---|
| `feat` | a new check, a new language, a new flag | minor |
| `fix` | a wrong finding, a false positive, a crash | patch |
| `perf` | a measured speedup | patch |
| `refactor` | no behavior change | none |
| `test` | tests only | none |
| `docs` | documentation only | none |
| `chore` | build, CI, dependencies, gitignore | none |
| `build` | a change to how the project is packaged | none |

## Scope

The module or subsystem, lowercased. It goes in the subject line, not the body,
because that is where a reader's eye lands first.

```
scan
analyzers
git
registry
detect
cli
ci
spec
readme
```

## Subject

- Lowercase, no trailing period.
- Imperative mood: "add", not "added" or "adds".
- Under 72 characters.
- Say what changed and why, when the why is not obvious from the diff.

Good:

```
perf: use indexOf for newline discovery in scanFile

A per character charCodeAt loop over a 525 MB corpus measured 3.7x slower.
split was slower than both while also allocating an array of every line.
```

Bad:

```
update stuff
fix bug
wip
```

## Why the type matters here specifically

The types are not decoration. A `fix` means someone shipped a wrong finding
and someone else had to look at their code and trust it less, and that is worth
being able to find with `git log --grep="^fix"`. A `perf` commit should carry
a number in its body, because an unmeasured speedup is a guess.

## Breaking the report schema

`docs/SPEC.md` defines a contract that other tools read. Changing a field name,
an enum value, or an exit code is:

```
feat(spec)!: drop the INFO severity level
```

with a `BREAKING CHANGE:` footer describing the migration. Bump
`SPEC_VERSION` in the same commit. Emit a `fix` or `feat` type for anything that
does not cross that line.
