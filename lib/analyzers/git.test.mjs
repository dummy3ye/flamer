import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { analyze } from './git.mjs';
import { analyze as analyzeUniversal } from './universal.mjs';

/** A FileRecord shaped the way lib/scan.mjs produces it. */
function file(rel, over = {}) {
  return {
    abs: `/fake/${rel}`,
    rel,
    name: rel.split('/').pop(),
    ext: rel.slice(rel.lastIndexOf('.')),
    size: 100,
    depth: rel.split('/').length - 1,
    lang: 'typescript',
    langVia: 'ext',
    isBinary: false,
    isGenerated: false,
    isLockfile: false,
    isTest: false,
    isEmpty: false,
    lines: 10,
    maxLine: 80,
    longLines: 0,
    crlf: false,
    noTrailingNewline: false,
    hasShebang: false,
    markers: [],
    secrets: [],
    conflictLines: [],
    ...over,
  };
}

const baseCtx = (over = {}) => ({
  root: process.cwd(),
  options: { commitLimit: 1000, noLockfileWarning: false },
  files: [],
  sourceFiles: [],
  structuredFiles: [],
  repoSourceFileCount: 0,
  rootFileNames: new Set(),
  profile: { scopes: [], tooling: {}, languages: [], dominantLanguage: 'typescript' },
  gitTracked: new Set(),
  ...over,
});

const titles = (findings) => findings.map((f) => f.title).join(' | ');

test('git: when git is unavailable, says so instead of crashing', () => {
  const out = analyze(
    baseCtx({ root: '/definitely/not/a/repo', options: { noGit: false, commitLimit: 0 } })
  );
  const f = out.find((x) => x.category === 'git');
  assert.ok(f);
  assert.match(f.title, /git/i);
});

const bloatCtx = (specs) => {
  const files = specs.map(([rel, lines]) => file(rel, { lines, size: lines * 30 }));
  return baseCtx({ files, sourceFiles: files, structuredFiles: files, repoSourceFileCount: files.length });
};

/** The per file bloat finding, as opposed to the across the codebase one. */
const fileBloat = (out) => out.find((x) => /file\(s\)/.test(x.title) && x.files);

test('bloat: flags a file far above the rest of its language', () => {
  const ctx = bloatCtx([
    ['a.ts', 50], ['b.ts', 60], ['c.ts', 55],
    ['huge.ts', 4000],
  ]);
  const out = analyzeUniversal(ctx);
  const f = fileBloat(out);
  assert.ok(f, `expected a per-file bloat finding, got: ${titles(out)}`);
  assert.ok(f.files.includes('huge.ts'), 'the outlier must be named');
  assert.ok(['HIGH', 'MEDIUM'].includes(f.severity));
});

test('bloat: stays quiet when every file is a similar size', () => {
  const ctx = bloatCtx([['a.ts', 50], ['b.ts', 55], ['c.ts', 52]]);
  const out = analyzeUniversal(ctx);
  assert.equal(out.some((x) => x.category === 'bloat'), false, titles(out));
});

test('bloat: reports the distribution it derived the threshold from', () => {
  const ctx = bloatCtx([['a.ts', 50], ['b.ts', 60], ['c.ts', 55], ['huge.ts', 4000]]);
  const f = fileBloat(analyzeUniversal(ctx));
  assert.match(f.detail, /median/);
});

test('bloat: a single huge file is not absorbed into the threshold', () => {
  // Regression: a p90-derived threshold would rise to include the outlier and
  // hide the exact file this check exists to catch.
  const ctx = bloatCtx([['a.ts', 50], ['b.ts', 60], ['c.ts', 55], ['huge.ts', 4000]]);
  const f = fileBloat(analyzeUniversal(ctx));
  assert.ok(f.files.includes('huge.ts'));
});

test('bloat: treats languages with different norms separately', () => {
  // 400 lines is unremarkable for SQL but large for TypeScript; the analyzer
  // must compare each file against its own language, not the repo as a whole.
  const ctx = bloatCtx([['q.sql', 400], ['a.ts', 60], ['b.ts', 60]]);
  const findings = analyzeUniversal(ctx).filter((x) => x.lang === 'sql');
  assert.equal(findings.length, 0, 'a single 400-line SQL file is not bloat');
});

test('bloat: reports a structurally oversized codebase', () => {
  const specs = Array.from({ length: 12 }, (_, i) => [`f${i}.ts`, 1200]);
  const out = analyzeUniversal(bloatCtx(specs));
  assert.ok(out.some((x) => /structurally oversized/.test(x.title)), titles(out));
});

test('bloat: counts every offender but keeps the list bounded', () => {
  const specs = Array.from({ length: 6 }, (_, i) => [`f${i}.ts`, 50]);
  specs.push(['outlier.ts', 5000]);
  const out = analyzeUniversal(bloatCtx(specs));
  const f = fileBloat(out);
  assert.equal(f.count, 1);
  assert.ok(f.files.length <= 10, 'file list stays bounded');
});

test('universal: aggregates markers by keyword', () => {
  const files = [
    file('a.ts', { markers: [{ type: 'TODO', line: 1, text: 'TODO' }] }),
    file('b.ts', { markers: [{ type: 'TODO', line: 2, text: 'TODO' }] }),
    file('c.ts', { markers: [{ type: 'FIXME', line: 1, text: 'FIXME' }] }),
  ];
  const out = analyzeUniversal(baseCtx({ files, sourceFiles: files, structuredFiles: files }));
  const todo = out.find((x) => /TODO marker/.test(x.title));
  const fixme = out.find((x) => /FIXME marker/.test(x.title));
  assert.ok(todo && fixme, titles(out));
  assert.equal(todo.count, 2);
  assert.ok(fixme.severity === 'HIGH', 'FIXME outranks TODO');
});

test('universal: never echoes a raw credential', () => {
  const files = [
    file('a.ts', { secrets: [{ kind: 'AWS access key id', line: 1, preview: 'AKIA************MPLE' }] }),
  ];
  const out = analyzeUniversal(baseCtx({ files, sourceFiles: files, structuredFiles: files }));
  const all = JSON.stringify(out);
  assert.match(all, /AKIA\*+MPLE/);
  assert.equal(/AKIAIOSFODNN7EXAMPLE/.test(all), false, 'raw credential leaked into the report');
});

test('universal: reports one finding per secret kind, not per match', () => {
  const files = [
    file('a.ts', { secrets: [{ kind: 'AWS access key id', line: 1, preview: 'AKIA************MPLE' }] }),
    file('b.ts', { secrets: [{ kind: 'AWS access key id', line: 9, preview: 'ASIA************XX99' }] }),
  ];
  const out = analyzeUniversal(baseCtx({ files, sourceFiles: files, structuredFiles: files }));
  const aws = out.filter((x) => /AWS access key/.test(x.title));
  assert.equal(aws.length, 1);
  assert.equal(aws[0].count, 2);
});

test('universal: unresolved merge conflicts are critical', () => {
  const files = [file('a.ts', { conflictLines: [3, 7] })];
  const out = analyzeUniversal(baseCtx({ files, sourceFiles: files, structuredFiles: files }));
  const f = out.find((x) => /merge conflict/.test(x.title));
  assert.ok(f, titles(out));
  assert.equal(f.severity, 'CRITICAL');
});

test('universal: a clean tree produces no findings', () => {
  const files = [file('a.ts'), file('b.ts', { lines: 20 })];
  assert.deepEqual(analyzeUniversal(baseCtx({ files, sourceFiles: files, structuredFiles: files })), []);
});
