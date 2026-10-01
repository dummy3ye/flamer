/**
 * Finding construction, severity ranking, and dedupe.
 *
 * Findings are deliberately factual: no jokes, no persona. The roast is
 * composed downstream (see skills/flamer/SKILL.md) from these primitives.
 */

export const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
const RANK = Object.fromEntries(SEVERITIES.map((s, i) => [s, i]));

export const CATEGORIES = [
  'security',
  'secrets',
  'deps',
  'testing',
  'bloat',
  'hygiene',
  'markers',
  'vcs',
  'config',
  'build',
  'script',
  'structure',
  'git',
  'error',
];

export function rank(severity) {
  const r = RANK[String(severity).toUpperCase()];
  return r === undefined ? SEVERITIES.length : r;
}

/**
 * Build a finding. Extra fields pass straight through.
 * @param {object} f
 */
export function finding(f) {
  const severity = String(f.severity || 'LOW').toUpperCase();
  if (RANK[severity] === undefined) {
    throw new Error(`Unknown severity "${f.severity}" (want one of ${SEVERITIES.join(', ')})`);
  }
  const category = f.category || 'hygiene';
  if (!CATEGORIES.includes(category)) {
    throw new Error(`Unknown category "${f.category}" (want one of ${CATEGORIES.join(', ')})`);
  }
  return {
    category,
    severity,
    title: f.title || 'Untitled finding',
    detail: f.detail || '',
    ...(f.files && f.files.length ? { files: dedupe(f.files).slice(0, 25) } : {}),
    ...(f.count !== undefined ? { count: f.count } : {}),
    ...(f.evidence !== undefined ? { evidence: f.evidence } : {}),
    ...(f.lang ? { lang: f.lang } : {}),
  };
}

function dedupe(arr) {
  return [...new Set(arr)];
}

/** Stable sort: severity first, then category, then title. */
export function sortFindings(findings) {
  return [...findings].sort(
    (a, b) =>
      rank(a.severity) - rank(b.severity) ||
      a.category.localeCompare(b.category) ||
      a.title.localeCompare(b.title)
  );
}

/** Count findings by severity, always including every level. */
export function severityTally(findings) {
  const tally = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  for (const f of findings) tally[f.severity] = (tally[f.severity] || 0) + 1;
  return tally;
}

/** Highest severity present, or null when there are no findings. */
export function worstSeverity(findings) {
  let worst = null;
  for (const f of findings) {
    if (worst === null || rank(f.severity) < rank(worst)) worst = f.severity;
  }
  return worst;
}
