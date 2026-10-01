/**
 * Test coverage ratio analysis, per language.
 *
 * Ratios are computed against the language's own source files, so a repo that
 * is 90% Rust and 10% Terraform is not judged on a blended number.
 */
import { finding } from '../util/findings.mjs';
import { languageById } from '../registry.mjs';

const fmt = (n) => n.toLocaleString('en-US');

/** Test file bands. Chosen so a repo is never praised or damned by a blip. */
const BANDS = [
  { min: 0, max: 0.0001, severity: 'CRITICAL', title: 'No tests at all', note: 'This is a house with no smoke detectors.' },
  { min: 0.0001, max: 0.05, severity: 'HIGH', title: 'Effectively untested', note: 'A rounding error is not a test suite.' },
  { min: 0.05, max: 0.15, severity: 'MEDIUM', title: 'Sparse test coverage', note: 'Token coverage. The risky paths stay untested.' },
  { min: 0.15, max: 0.35, severity: 'LOW', title: 'Thin but present test coverage', note: 'Real tests, but a low ratio against production code.' },
  { min: 0.35, max: 1, severity: 'INFO', title: 'Reasonable test coverage', note: 'Solid ratio. The main gap will be in the untestable edges.' },
];

export function analyzeTestRatio(ctx) {
  const out = [];

  const byLang = new Map();
  for (const f of ctx.sourceFiles) {
    if (!byLang.has(f.lang)) byLang.set(f.lang, { src: 0, test: 0, testFiles: [] });
    const e = byLang.get(f.lang);
    if (f.isTest) {
      e.test++;
      e.testFiles.push(f.rel);
    } else {
      e.src++;
    }
  }

  for (const [langId, e] of byLang) {
    if (['docker', 'terraform', 'notebook', 'sql'].includes(langId)) continue;
    const lang = languageById(langId);
    const total = e.src + e.test;
    if (total === 0 || e.src === 0) continue;
    const ratio = e.test / total;
    const pct = Math.round(ratio * 100);
    const band = BANDS.find((b) => ratio >= b.min && ratio < b.max) || BANDS[BANDS.length - 1];

    // Don't cry wolf: skip the "zero tests" callout only when the entire repo
    // is trivial. A scoped run against a small package should still answer, so
    // this uses the count for the whole repo, not the scoped one.
    const repoIsTiny = (ctx.repoSourceFileCount ?? ctx.sourceFiles.length) < 3;
    if (e.test === 0 && repoIsTiny) continue;

    if (e.test === 0) {
      out.push(
        finding({
          category: 'testing',
          severity: 'CRITICAL',
          title: `Zero ${lang?.label ?? langId} tests against ${fmt(e.src)} source file(s)`,
          detail:
            `No test files matched the ${lang?.label ?? langId} test patterns ` +
            `(${lang?.tests?.slice(0, 3).join(', ')}) across ${fmt(e.src)} source file(s).`,
          lang: langId,
        })
      );
      continue;
    }

    out.push(
      finding({
        category: 'testing',
        severity: band.severity,
        title: `${lang?.label ?? langId} test ratio ${pct}% (${fmt(e.test)} test / ${fmt(e.src)} source)`,
        detail: `${band.note}`,
        count: e.test,
        lang: langId,
      })
    );
  }

  return out;
}

/**
 * Test frameworks present in the repo. A ratio with no framework is weaker
 * news than the ratio alone suggests.
 */
export function analyzeTestFramework(ctx) {
  const out = [];
  const has = (name) => ctx.rootFileNames.has(name);
  const anyOf = (names) => names.some((n) => has(n));

  const claimsTests = ctx.profile.dominantLanguage === 'javascript' || ctx.profile.dominantLanguage === 'typescript';
  const testFilesExist = ctx.sourceFiles.some((f) => f.isTest);

  if (claimsTests && testFilesExist) {
    const hasRunner = anyOf(['vitest.config.ts', 'vitest.config.js', 'jest.config.js', 'jest.config.ts', 'jest.config.mjs']);
    if (!hasRunner && !ctx.sourceFiles.some((f) => /\.test\.[cm]?[jt]sx?$/.test(f.rel) || /\.spec\.[cm]?[jt]sx?$/.test(f.rel))) {
      out.push(
        finding({
          category: 'testing',
          severity: 'LOW',
          title: 'Test files present but no runner configuration found',
          detail: 'No jest/vitest/mocha config and no conventionally-named spec files were detected.',
        })
      );
    }
  }

  return out;
}

export function analyze(ctx) {
  return [...analyzeTestRatio(ctx), ...analyzeTestFramework(ctx)];
}
