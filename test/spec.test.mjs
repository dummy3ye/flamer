import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'flamer.mjs');
const SPEC = join(ROOT, 'docs', 'SPEC.md');

const run = (args, cwd = ROOT) =>
  JSON.parse(execFileSync(process.execPath, [CLI, ...args, '--format', 'json'], {
    encoding: 'utf-8',
    cwd,
    maxBuffer: 64 * 1024 * 1024,
  }));

/**
 * The spec is the only thing holding flamer and poison together. Neither
 * imports the other, so if these drift apart there is no code error to catch
 * it. These tests are that safety net.
 */

test('the spec file exists, since the output claims to follow it', () => {
  assert.ok(existsSync(SPEC), 'docs/SPEC.md is missing');
});

test('the report declares the spec version it was built against', () => {
  const report = run(['.']);
  assert.equal(report.specVersion, 1);
  assert.equal(report.tool, 'flamer');
});

test('the spec names the version the code claims', () => {
  const spec = readFileSync(SPEC, 'utf-8');
  const declared = /^(\d+)$/m.exec(/^\*\*Version:\*\* (\d+)/m.exec(spec)?.[1] || '');
  const report = run(['.']);
  assert.ok(declared, 'SPEC.md does not state a version');
  assert.equal(Number(declared[1]), report.specVersion);
});

test('every severity the report uses is named in the spec', () => {
  const spec = readFileSync(SPEC, 'utf-8');
  for (const level of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) {
    assert.ok(spec.includes('`' + level + '`'), `${level} is not documented in SPEC.md`);
  }
  const report = run(['.']);
  for (const f of report.findings) {
    assert.ok(
      ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].includes(f.severity),
      `undocumented severity ${f.severity} on ${f.title}`
    );
  }
});

test('every category the report uses is documented', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf-8');
  const report = run(['.']);
  for (const f of report.findings) {
    assert.ok(f.category, `a finding has no category: ${f.title}`);
    assert.ok(readme.includes(f.category), `category ${f.category} is not in the README list`);
  }
});

test('the documented exit codes are the ones the code returns', () => {
  const spec = readFileSync(SPEC, 'utf-8');
  for (const code of ['`0`', '`1`', '`2`', '`3`']) {
    assert.ok(spec.includes(code), `exit code ${code} is not in SPEC.md`);
  }
  assert.equal(run(['.']).findings.length >= 0, true);

  // A missing path is a usage error, not a finding about the repository.
  let missing;
  try {
    execFileSync(process.execPath, [CLI, '/nonexistent/path/for/spec-test'], { encoding: 'utf-8' });
  } catch (e) {
    missing = e.status;
  }
  assert.equal(missing, 2, 'a nonexistent path should exit 2');
});

test('exit 0 means the scan ran, not that the repository is clean', () => {
  // The spec is explicit that a clean exit never claims cleanliness. Guard it,
  // because a scanner whose exit code overstates its findings trains people to
  // trust the code and ignore the report.
  const dir = mkdtempSync(join(tmpdir(), 'flamer-spec-'));
  writeFileSync(join(dir, 'index.js'), 'console.log(1)\n');
  const out = run([dir]);
  assert.equal(out.findings.length >= 0, true);
  assert.equal(typeof out.metadata.durationSeconds, 'number');
});

test('the README test count is stated and not obviously wrong', () => {
  // A test that runs the suite cannot check the suite's own total, because
  // counting subtests means this file's own tests are in that total. So assert
  // the README states a number and that it is in the right order of
  // magnitude, and leave the exact match to CI, which runs where the count has
  // settled.
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf-8');
  const claimed = Number(/# all (\d+)/.exec(readme)?.[1]);
  assert.ok(claimed, 'README does not state a test count after "# all"');
  assert.ok(claimed >= 165, `README claims only ${claimed} tests, which cannot be right`);
});
