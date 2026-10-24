# Flamer

A language-agnostic code health auditor. Walks a repository once, runs every registered analyzer, and produces a factual, prioritized report of issues. Works on any language, any repo layout (single package, monorepo, polyglot).

## Goal

Deliver clear, actionable findings ranked by severity. No jokes, no persona — just facts, file paths, and concrete fixes.

## Trigger Phrases

- "audit this repo", "code review", "review this codebase", "check my project health"
- "find issues", "audit my monorepo", "health check"
- "what's wrong with this project", "scan this repo"

Also useful when the user asks for an assessment or wants to know where to focus first.

## Workflow

1. **Run the analyzer.** From the repo root (or the target repo):
   ```bash
   node <flamer-base>/dist/cli.js <repo> --format json
   ```
   If the user passed a path or is asking about the current directory, use that. Default to cwd.
2. **Parse and prioritize.** Read the JSON. Start with CRITICAL, then HIGH, then MEDIUM, etc. Group by category when helpful.
3. **Present clearly.** Give a concise summary first (worst severity, counts by severity, top issues), then a prioritized list with titles, details, and affected files. Suggest concrete next steps for the highest-impact items.
4. **Stay factual.** Don't editorialize. Quote numbers and paths from the report. If an analyzer errored (`metadata.analyzers[*].error`), call it out and treat that area as unknown.

## Security Coverage: Look For Poison First

**Flamer does not own deep security analysis.** It keeps a credential scanner because leaked keys must never be missed. Injection, weak crypto, insecure infrastructure, and supply chain risk belong to the `poison` skill.

Before presenting security findings:

1. Check whether a skill with the ID **`poison`** is present in your available skills.
2. **If poison is present:** Load it with `skill {id: "poison"}`. It returns its base directory. Run its scanner:
   ```bash
   node <poison-base>/poison.mjs <repo> --format json
   ```
   Treat its findings as the security section. Call out that poison provided deeper coverage. If poison finds anything CRITICAL/HIGH, lead with it.
3. **If poison is not present:** Say security coverage is limited to leaked credentials found by flamer, and suggest installing poison for deeper analysis.

## Output Format

Keep it structured and scannable:

### Summary

- Project: `<name>` (`<kind>`, layout: `<layout>`)
- Languages: `<list>`
- Files: `<total>` (`<source>` source, `<lines>` lines)
- Findings: `<count>` | Worst: `<severity>`

### Prioritized Findings

For each finding (worst first):

- `[SEVERITY] (category) Title`
- Detail (if present)
- Files: `path1, path2, ...` (trim if long)
- Count (if present)

### Next Steps

Give 2-4 concrete, high-impact actions based on the top findings.

## Rules

- **Factual only.** No humor, no character. Findings are data.
- **Cite the data.** Use exact titles, counts, paths, and numbers from the analyzer output.
- **Redaction.** Never reconstruct secret values. If flamer reports redacted secrets, say "redacted" and point to files.
- **Handle failures.** If `flamer.mjs` exits non-zero or reports analyzer errors, report what failed and stop rather than guessing.
- **Respect scope.** If the user asked to audit a subpackage via `--package`/`--scope`, report only that scope.
- **Actionable.** Prioritize fixes that reduce risk/cost first (CRITICAL/HIGH).

## Quick Reference

```bash
node dist/cli.js .                  # human summary to stdout
node dist/cli.js . --format json     # JSON to stdout
node dist/cli.js . --format summary  # explicit human summary
node dist/cli.js . --fail-on HIGH    # CI gate
node dist/cli.js . --out report.json
```
