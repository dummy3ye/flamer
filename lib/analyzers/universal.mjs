/**
 * Universal analyzer: everything that applies regardless of language.
 *
 * Consumes the FileRecords produced by lib/scan.mjs. Never reads a file twice.
 */
import { finding } from '../util/findings.mjs';
import { languageById } from '../registry.mjs';

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function median(sorted) {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

const fmt = (n) => n.toLocaleString('en-US');

/**
 * Adaptive bloat detection.
 *
 * A fixed 300-line cap is wrong for every language. Instead each language
 * supplies a baseline, and the *observed* distribution refines it: only files
 * that are outliers relative to their own language get flagged. This keeps the
 * signal useful in a repo of 5k-line SQL migrations and in one of 40-line Rust
 * modules alike.
 */
export function analyzeBloat(ctx) {
  const out = [];
  const byLang = new Map();

  for (const f of ctx.sourceFiles) {
    if (!byLang.has(f.lang)) byLang.set(f.lang, []);
    byLang.get(f.lang).push(f);
  }

  for (const [langId, group] of byLang) {
    const lang = languageById(langId);
    const soft = lang?.bloat?.soft ?? 300;
    const hard = lang?.bloat?.hard ?? 700;
    const lines = group.map((f) => f.lines).sort((a, b) => a - b);
    const p90 = percentile(lines, 90);
    const med = median(lines);

    // Adaptive ceiling, derived from the median rather than a high percentile.
    // A p90-based threshold fails on small samples: with four files of
    // 50/55/60/4000 lines the 90th percentile *is* the 4000-line outlier, so
    // the threshold rises to swallow the very file we want to catch. The median
    // is unmoved by a single large file, and a multiple of it still stretches
    // for legitimately large codebases.
    const adaptive = Math.max(soft, Math.round(med * 3));

    const offenders = group
      .filter((f) => f.lines > adaptive)
      .sort((a, b) => b.lines - a.lines);

    // Systemic bloat first, and *before* the early return below. When every
    // file is large there are no outliers, so gating this on `offenders`
    // existing would make it unreachable in precisely the case it describes.
    if (p90 > hard) {
      out.push(
        finding({
          category: 'bloat',
          severity: 'MEDIUM',
          title: `${lang?.label ?? langId} codebase is structurally oversized`,
          detail:
            `p90 line count is ${fmt(p90)}, above the ${fmt(hard)}-line guideline, so the norm itself is the problem ` +
            `rather than a few outliers. Median is ${fmt(med)} across ${fmt(group.length)} file(s). ` +
            `Consider a module-boundary pass.`,
          lang: langId,
        })
      );
    }

    if (offenders.length === 0) continue;

    const severe = offenders.filter((f) => f.lines > hard);
    const totalLines = offenders.reduce((s, f) => s + f.lines, 0);

    if (severe.length > 0) {
      out.push(
        finding({
          category: 'bloat',
          severity: 'HIGH',
          title: `${severe.length} oversized ${lang?.label ?? langId} file(s) over ${fmt(hard)} lines`,
          detail:
            `${severe.length} file(s) exceed the ${lang?.label ?? langId} hard limit of ${fmt(hard)} lines. ` +
            `Language median is ${fmt(med)} lines, p90 is ${fmt(p90)}. Consider splitting by responsibility.`,
          files: severe.slice(0, 10).map((f) => f.rel),
          count: severe.length,
          lang: langId,
        })
      );
    }

    const rest = offenders.filter((f) => f.lines <= hard);
    if (rest.length > 0) {
      out.push(
        finding({
          category: 'bloat',
          severity: 'MEDIUM',
          title: `${offenders.length} ${lang?.label ?? langId} file(s) above the ${fmt(adaptive)}-line adaptive threshold`,
          detail:
            `Threshold derived from this repo's own median (${fmt(med)} lines, 3x = ${fmt(adaptive)}), ` +
            `floored at the ${lang?.label ?? langId} baseline of ${fmt(soft)}. ` +
            `These files total ${fmt(totalLines)} lines.`,
          files: offenders.slice(0, 10).map((f) => f.rel),
          count: offenders.length,
          lang: langId,
        })
      );
    }
  }

  return out;
}

/** Empty, nearly empty, and stub files. */
export function analyzeEmpty(ctx) {
  const out = [];
  const empties = ctx.sourceFiles.filter((f) => f.size === 0);

  // "Stub" only means something relative to the project's own norms. A repo of
  // deliberately tiny modules is neatly factored, not abandoned, so only flag
  // nearly empty files when the same language also contains substantial ones.
  const structured = ctx.structuredFiles;
  const langHasSubstantial = new Set(
    structured.filter((f) => f.lines > 20).map((f) => f.lang)
  );
  const stubs = structured.filter(
    (f) => f.size > 0 && f.lines <= 2 && langHasSubstantial.has(f.lang)
  );

  if (empties.length > 0) {
    out.push(
      finding({
        category: 'bloat',
        severity: empties.length > 5 ? 'MEDIUM' : 'LOW',
        title: `${empties.length} completely empty source file(s)`,
        detail: 'Zero-byte source files. Either a placeholder that was committed by accident, or a file whose contents were lost.',
        files: empties.slice(0, 10).map((f) => f.rel),
        count: empties.length,
      })
    );
  }
  if (stubs.length > 0) {
    out.push(
      finding({
        category: 'bloat',
        severity: 'LOW',
        title: `${stubs.length} stub source file(s) of 2 lines or fewer`,
        detail: 'Files with almost no content. Verify these are intentional scaffolding and not abandoned work.',
        files: stubs.slice(0, 10).map((f) => f.rel),
        count: stubs.length,
      })
    );
  }
  return out;
}

/**
 * Work item annotations found in comments, aggregated by keyword.
 * The recognised keywords live in MARKER_KEYWORDS in lib/scan.mjs; they are
 * named by variable rather than spelled out here so that this doc comment is
 * not itself reported by the marker scan.
 */
export function analyzeMarkers(ctx) {
  const out = [];
  const byType = new Map();
  for (const f of ctx.sourceFiles) {
    for (const m of f.markers || []) {
      if (!byType.has(m.type)) byType.set(m.type, { count: 0, files: new Set(), stale: 0 });
      const entry = byType.get(m.type);
      entry.count++;
      entry.files.add(f.rel);
    }
  }

  const total = [...byType.values()].reduce((s, e) => s + e.count, 0);
  if (total === 0) return out;

  for (const [type, entry] of byType) {
    const severity =
      type === 'FIXME' || type === 'BUG' || type === 'HACK'
        ? 'HIGH'
        : type === 'XXX'
          ? 'HIGH'
          : 'MEDIUM';
    out.push(
      finding({
        category: 'markers',
        severity: entry.count > 20 ? (severity === 'MEDIUM' ? 'HIGH' : severity) : severity,
        title: `${entry.count} ${type} marker(s) across ${entry.files.size} file(s)`,
        detail:
          `Extracted from comments only (string literals excluded), so these are real annotations. ` +
          `A ${type} is a promise to future-you with no due date.`,
        files: [...entry.files].slice(0, 10),
        count: entry.count,
      })
    );
  }

  if (total > 50) {
    out.push(
      finding({
        category: 'markers',
        severity: 'HIGH',
        title: `${fmt(total)} unresolved markers repo-wide`,
        detail: 'Marker count is high enough to be a tracking-system failure rather than a set of individual notes.',
        count: total,
      })
    );
  }
  return out;
}

/** Hardcoded credentials in tracked files. */
export function analyzeSecrets(ctx) {
  const out = [];

  // The same credential can match several patterns (an AWS key id also looks
  // like a generic `key = "..."` assignment). Dedupe by file+line, keeping the
  // most specific classification so one leak is not reported three times.
  const GENERIC = new Set(['hardcoded secret assignment', 'bearer token']);
  const unique = new Map(); // `${rel}:${line}` -> secret
  for (const f of ctx.sourceFiles) {
    for (const s of f.secrets || []) {
      const key = `${f.rel}:${s.line}`;
      const prev = unique.get(key);
      if (!prev) {
        unique.set(key, { ...s, rel: f.rel });
      } else if (GENERIC.has(prev.kind) && !GENERIC.has(s.kind)) {
        unique.set(key, { ...s, rel: f.rel });
      }
    }
  }

  if (unique.size === 0) return out;

  const byKind = new Map();
  for (const s of unique.values()) {
    if (!byKind.has(s.kind)) byKind.set(s.kind, { files: new Set(), samples: [] });
    const e = byKind.get(s.kind);
    e.files.add(s.rel);
    if (e.samples.length < 3) e.samples.push(`${s.rel}:${s.line} (${s.preview})`);
  }

  for (const [kind, e] of byKind) {
    out.push(
      finding({
        category: 'secrets',
        severity: 'CRITICAL',
        title: `Possible ${kind} committed to the repository`,
        detail:
          `Found in ${e.files.size} file(s). Values are redacted in this report. ` +
          `Examples: ${e.samples.join('; ')}. ` +
          `Treat as compromised: rotate the credential, then purge it from history.`,
        files: [...e.files].slice(0, 10),
        count: e.files.size,
      })
    );
  }
  return out;
}

/** Unresolved merge conflict markers. */
export function analyzeConflicts(ctx) {
  const out = [];
  const conflicted = ctx.sourceFiles.filter((f) => f.conflictLines && f.conflictLines.length > 0);
  if (conflicted.length === 0) return out;
  out.push(
    finding({
      category: 'hygiene',
      severity: 'CRITICAL',
      title: `Unresolved merge conflict markers in ${conflicted.length} file(s)`,
      detail:
        `Conflict markers are still present in the working tree. ` +
        `Files: ${conflicted.slice(0, 8).map((f) => f.rel).join(', ')}.` +
        (conflicted.length > 8 ? ` (+${conflicted.length - 8} more)` : ''),
      files: conflicted.slice(0, 10).map((f) => f.rel),
      count: conflicted.length,
    })
  );
  return out;
}

/** Overlong lines, mixed line endings, missing trailing newlines. */
export function analyzeFormatting(ctx) {
  const out = [];
  const structured = ctx.structuredFiles;
  const long = structured.filter((f) => f.longLines > 0);
  if (long.length > 0) {
    out.push(
      finding({
        category: 'hygiene',
        severity: 'MEDIUM',
        title: `${long.length} file(s) contain lines over 200 characters`,
        detail:
          `${fmt(long.reduce((s, f) => s + f.longLines, 0))} overlong line(s) in total. ` +
          `Longest offenders: ${long
            .sort((a, b) => b.maxLine - a.maxLine)
            .slice(0, 5)
            .map((f) => `${f.rel} (${f.maxLine} cols)`)
            .join(', ')}.`,
        files: long.slice(0, 10).map((f) => f.rel),
        count: long.length,
      })
    );
  }

  const crlf = structured.filter((f) => f.crlf);
  const lf = structured.filter((f) => !f.crlf);
  if (crlf.length > 0 && lf.length > 0) {
    const crlfPct = Math.round((crlf.length / (crlf.length + lf.length)) * 100);
    if (crlfPct > 3 && crlfPct < 97) {
      out.push(
        finding({
          category: 'hygiene',
          severity: 'LOW',
          title: `Mixed line endings (${crlfPct}% CRLF, ${100 - crlfPct}% LF)`,
          detail:
            `${crlf.length} CRLF file(s) and ${lf.length} LF file(s) coexist. ` +
            `A .gitattributes with * text=auto eol=lf removes the whole category of bug.`,
          files: crlf.slice(0, 8).map((f) => f.rel),
          count: crlf.length,
        })
      );
    }
  }

  const noNl = structured.filter((f) => f.noTrailingNewline);
  if (noNl.length > 0) {
    out.push(
      finding({
        category: 'hygiene',
        severity: 'LOW',
        title: `${noNl.length} file(s) missing a trailing newline`,
        detail: 'POSIX convention: text files end with a newline. Causes noisy diffs.',
        files: noNl.slice(0, 10).map((f) => f.rel),
        count: noNl.length,
      })
    );
  }
  return out;
}

/** Structural smells: extreme path depth, giant files, build artifacts. */
export function analyzeStructure(ctx) {
  const out = [];

  const deep = ctx.structuredFiles.filter((f) => f.depth > 8);
  if (deep.length > 0) {
    out.push(
      finding({
        category: 'structure',
        severity: 'LOW',
        title: `${deep.length} file(s) nested more than 8 directories deep`,
        detail: `Deepest: ${deep.sort((a, b) => b.depth - a.depth).slice(0, 5).map((f) => `${f.rel} (depth ${f.depth})`).join(', ')}.`,
        files: deep.slice(0, 8).map((f) => f.rel),
        count: deep.length,
      })
    );
  }

  const vendored = ctx.structuredFiles.filter(
    (f) => f.isGenerated || /(^|\/)(vendor|third[_-]?party|extern|external|deps|generated)([\/_-]|$)/i.test(f.rel)
  );
  if (vendored.length > 20) {
    out.push(
      finding({
        category: 'structure',
        severity: 'MEDIUM',
        title: `${fmt(vendored.length)} vendored or generated source file(s) checked into the tree`,
        detail:
          'Generated and third-party sources are committed alongside first-party code, which inflates search results, ' +
          'language statistics, and review surface.',
        files: vendored.slice(0, 10).map((f) => f.rel),
        count: vendored.length,
      })
    );
  }

  return out;
}

/** Shell scripts without a shebang, plus executable permission sanity. */
export function analyzeShebangs(ctx) {
  const out = [];
  const scripts = ctx.sourceFiles.filter((f) => ['shell', 'python', 'ruby', 'perl'].includes(f.lang));
  const noShebang = scripts.filter((f) => !f.hasShebang && f.size > 0);
  if (noShebang.length > 0) {
    out.push(
      finding({
        category: 'hygiene',
        severity: 'LOW',
        title: `${noShebang.length} script file(s) with no shebang`,
        detail:
          `Scripts without an interpreter line depend on however they are invoked. ` +
          `Files: ${noShebang.slice(0, 6).map((f) => f.rel).join(', ')}.`,
        files: noShebang.slice(0, 10).map((f) => f.rel),
        count: noShebang.length,
      })
    );
  }
  return out;
}

export function analyze(ctx) {
  return [
    ...analyzeSecrets(ctx),
    ...analyzeConflicts(ctx),
    ...analyzeBloat(ctx),
    ...analyzeEmpty(ctx),
    ...analyzeMarkers(ctx),
    ...analyzeFormatting(ctx),
    ...analyzeStructure(ctx),
    ...analyzeShebangs(ctx),
  ];
}
