# Scanner spec, version 1

This document is the contract between `flamer` and `poison`. They are separate
projects with no shared code, so this file is the only thing keeping their
output compatible. `poison` holds the canonical copy; `flamer` mirrors it and
carries a `specVersion` field in its output.

**Canonical:** `poison/docs/SPEC.md`
**Version:** 1
**Bump policy:** any change to a field name, an enum value, or an exit code is a
major version bump. Adding a new optional field is a minor bump. Each tool's
output must carry the `specVersion` it was built against, so a drift is visible
in the data rather than discovered by a broken script.

## Severity

Four levels, uppercase, no numeric weights. Every tool uses the same names.

| Level | Means |
|---|---|
| `CRITICAL` | Actively exploitable, or a live credential. Fix before the next commit. |
| `HIGH` | A real weakness a reasonable attacker could reach. Fix this cycle. |
| `MEDIUM` | Bad practice that becomes dangerous in combination. Fix soon. |
| `LOW` | Hygiene. Fix when the file is next touched. |

Deliberately absent: `INFO` and `WARNING`. A finding is something wrong. If it
is only worth mentioning, it is not a finding. `flamer` additionally uses `INFO`
in its own report for suggestions, and that is a documented exception, not a
shared level.

## Confidence

How sure the tool is that the finding is real, which is a different axis from
severity. A `CRITICAL` at `possible` confidence is not the same claim as a
`CRITICAL` at `certain`.

| Level | Means |
|---|---|
| `certain` | The pattern is unambiguous and admits no correct reading. |
| `likely` | The pattern matched and no exemption applied, but a correct reading may still exist. |
| `possible` | The pattern matched and an exemption might apply, but the tool could not tell. |

`poison` defaults to `likely`, never `certain`, because a pattern match cannot
establish reachability. Only rules that describe something present and wrong,
with no correct alternative reading, may claim `certain`. The number of rules
using the default is reported in the output, so the weakening is visible rather
than silent.

## Rule IDs

Stable, never reused, never renumbered. A rule ID is a permanent handle for
suppressions, baselines, and issue links, so retiring one leaves a gap.

```
DOMAIN-SUBSYSTEM-NNN
```

| Domain | Covers |
|---|---|
| `SEC` | Credentials and secrets |
| `INJ` | Injection |
| `CRY` | Cryptography and TLS |
| `AUTH` | Authentication and session handling |
| `MEM` | Memory safety |
| `CNI` | Container and image supply chain |
| `TF` | Terraform and infrastructure as code |
| `K8S` | Kubernetes manifests |
| `CI` | CI and pipeline configuration |
| `ANS` | Ansible |
| `DEP` | Dependency risk |
| `FW` | Framework specific security |
| `TPL` | Template engines and ORM query building |
| `CFN` | AWS CloudFormation |
| `PUL` | Pulumi |
| `HELM` | Helm charts |
| `NGX` | nginx configuration |
| `SYS` | systemd units |
| `GLCI` | GitLab CI |

A finding's `ruleId` is enough to look up its documentation, its confidence
rationale, and its fix. The lookup is `poison.mjs <repo> --explain <ruleId>`.

## Suppressions

In source, in the file the finding is in, as a comment in that file's comment
syntax:

```
// poison-ignore-next-line SEC-ASSIGN-001 committed fixture
```

| Form | Effect |
|---|---|
| `poison-ignore-next-line <ruleId>` | suppress on the following line |
| `poison-ignore-line <ruleId>` | suppress on this line |
| `poison-ignore-file <ruleId>` | suppress for the whole file |
| `poison-ignore-start` / `poison-ignore-stop` | suppress a block, must be paired |

A suppression with no `ruleId` is a usage error, not a blanket suppression.
Silencing a whole file by accident is the failure mode this design exists to
prevent. Suppressions are reported in `metadata.suppressedCount` so a clean
scan cannot hide a silently disabled rule.

`flamer` does not use source suppressions. Its findings are about the shape of a
repository rather than a line, so there is no line to attach one to.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Scan completed. Findings may exist; read the report. |
| `1` | A finding reached the `--fail-on` threshold. |
| `2` | Usage error. Bad flag, unreadable path, malformed config. |
| `3` | Internal error. A bug. |

Exit `0` never means "clean". It means the scan ran. A tool whose exit code
claims cleanliness that the report contradicts trains people to trust the code
and ignore the output.

## JSON envelope

Both tools emit a report with this shape. `flamer` has a richer `project` block
because it reports on repository structure; `poison`'s `findings` carry the
`ruleId`, `confidence`, `fix`, `cwe` and `owasp` fields that `flamer` does not
have.

```jsonc
{
  "specVersion": 1,
  "tool": "poison",                 // or "flamer"
  "version": "0.1.0",
  "generatedAt": "2026-10-02T00:00:00.000Z",
  "summary": {
    "total": 116,
    "bySeverity": { "CRITICAL": 4, "HIGH": 58, "MEDIUM": 33, "LOW": 21 },
    "worst": "CRITICAL",
    "blocking": 62
  },
  "findings": [
    {
      "ruleId": "INJ-PY-001",
      "severity": "HIGH",
      "confidence": "likely",
      "file": "src/config.py",
      "line": 6,
      "column": 5,
      "title": "Shell command built with string concatenation",
      "detail": "os.system receives a value that is concatenated into the command string.",
      "fix": "Pass an argument list to subprocess.run with shell=False.",
      "cwe": "CWE-78",
      "owasp": "A03:2021",
      "snippet": "os.system(\"tar czf backup.tgz \" + user_input)"
    }
  ],
  "metadata": {
    "filesScanned": 3192,
    "bytesScanned": 233570000,
    "durationSeconds": 6.07,
    "suppressedCount": 0,
    "analyzers": [{ "id": "secret", "ms": 210, "findings": 12, "error": null }]
  }
}
```

Required on every finding: `ruleId`, `severity`, `confidence`, `title`,
`detail`, `fix`. A finding without a fix is a complaint, not a tool.

`snippet` and any value derived from a credential must be redacted. A security
scanner that echoes the secret it found has leaked it a second time, into a CI
log that is usually less protected than the repository it came from.

## Confidence that the tool is trustworthy

Not a shared concept, but a shared commitment. Both tools are excluded from
their own source and their own test fixtures by default, and both are expected
to report nothing on themselves. A scanner that cries wolf on its own test
suite gets switched off, which is worse than not shipping it.
