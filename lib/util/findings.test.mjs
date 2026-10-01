import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  finding,
  rank,
  sortFindings,
  severityTally,
  worstSeverity,
  SEVERITIES,
  CATEGORIES,
} from './findings.mjs';

test('finding: builds a well-formed finding', () => {
  const f = finding({ category: 'secrets', severity: 'CRITICAL', title: 'Leak', detail: 'why' });
  assert.equal(f.category, 'secrets');
  assert.equal(f.severity, 'CRITICAL');
  assert.equal(f.title, 'Leak');
  assert.equal(f.detail, 'why');
});

test('finding: defaults are applied', () => {
  const f = finding({ title: 'Bare' });
  assert.equal(f.severity, 'LOW');
  assert.equal(f.category, 'hygiene');
  assert.equal(f.detail, '');
});

test('finding: normalizes severity casing', () => {
  assert.equal(finding({ severity: 'critical', title: 'x' }).severity, 'CRITICAL');
  assert.equal(finding({ severity: 'High', title: 'x' }).severity, 'HIGH');
});

test('finding: rejects an unknown severity', () => {
  assert.throws(() => finding({ severity: 'URGENT', title: 'x' }), /Unknown severity/);
});

test('finding: rejects an unknown category', () => {
  assert.throws(() => finding({ category: 'vibes', title: 'x' }), /Unknown category/);
});

test('finding: omits files when empty', () => {
  const f = finding({ title: 'x' });
  assert.equal('files' in f, false);
});

test('finding: deduplicates the file list', () => {
  const f = finding({ title: 'x', files: ['a.ts', 'a.ts', 'b.ts'] });
  assert.deepEqual(f.files, ['a.ts', 'b.ts']);
});

test('finding: caps the file list so output stays bounded', () => {
  const many = Array.from({ length: 100 }, (_, i) => `f${i}.ts`);
  const f = finding({ title: 'x', files: many });
  assert.equal(f.files.length, 25);
  assert.equal(f.files[0], 'f0.ts');
});

test('finding: passes through optional fields', () => {
  const f = finding({ title: 'x', count: 4, lang: 'rust', evidence: 'raw' });
  assert.equal(f.count, 4);
  assert.equal(f.lang, 'rust');
  assert.equal(f.evidence, 'raw');
});

test('rank: orders severities worst first', () => {
  assert.ok(rank('CRITICAL') < rank('HIGH'));
  assert.ok(rank('HIGH') < rank('MEDIUM'));
  assert.ok(rank('MEDIUM') < rank('LOW'));
  assert.ok(rank('LOW') < rank('INFO'));
});

test('rank: an unknown severity sorts last', () => {
  assert.ok(rank('NOPE') >= SEVERITIES.length);
});

test('sortFindings: orders by severity, then category, then title', () => {
  const input = [
    finding({ category: 'bloat', severity: 'LOW', title: 'z' }),
    finding({ category: 'deps', severity: 'CRITICAL', title: 'b' }),
    finding({ category: 'git', severity: 'CRITICAL', title: 'a' }),
    finding({ category: 'hygiene', severity: 'HIGH', title: 'c' }),
  ];
  const out = sortFindings(input);
  assert.deepEqual(out.map((f) => `${f.severity}:${f.category}`), [
    'CRITICAL:deps',
    'CRITICAL:git',
    'HIGH:hygiene',
    'LOW:bloat',
  ]);
});

test('sortFindings: does not mutate its input', () => {
  const input = [finding({ severity: 'LOW', title: 'a' }), finding({ severity: 'CRITICAL', title: 'b' })];
  const before = input.map((f) => f.severity);
  sortFindings(input);
  assert.deepEqual(input.map((f) => f.severity), before);
});

test('severityTally: counts every level, including zeroes', () => {
  const tally = severityTally([finding({ severity: 'LOW', title: 'a' }), finding({ severity: 'LOW', title: 'b' })]);
  assert.equal(tally.LOW, 2);
  assert.equal(tally.CRITICAL, 0);
  for (const s of SEVERITIES) assert.ok(s in tally, `${s} should always be present`);
});

test('severityTally: an empty list yields all zeroes', () => {
  const tally = severityTally([]);
  for (const s of SEVERITIES) assert.equal(tally[s], 0);
});

test('worstSeverity: returns the highest severity present', () => {
  const list = [finding({ severity: 'LOW', title: 'a' }), finding({ severity: 'CRITICAL', title: 'b' }), finding({ severity: 'HIGH', title: 'c' })];
  assert.equal(worstSeverity(list), 'CRITICAL');
});

test('worstSeverity: returns null when there is nothing to report', () => {
  assert.equal(worstSeverity([]), null);
});

test('registry constants: severities and categories are non-empty and unique', () => {
  assert.ok(SEVERITIES.length > 0);
  assert.equal(new Set(SEVERITIES).size, SEVERITIES.length);
  assert.ok(CATEGORIES.length > 0);
  assert.equal(new Set(CATEGORIES).size, CATEGORIES.length);
});
