import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  extractMarkers,
  extractSecrets,
  isSource,
  isLineStructured,
  scanFile,
  SECRET_PATTERNS,
} from './scan.mjs';

/* Comment specs drawn from the registry, so the tests exercise the real ones. */
const JS = { line: '//', block: [['/*', '*/']] };
const HASH = { line: '#', block: [] };
const DASH = { line: '--', block: [['/*', '*/']] };
const HASKELL = { line: '--', block: [['{-', '-}']] };
const LUA = { line: '--', block: [['--[[', ']]']] };
const POWERSHELL = { line: '#', block: [['<#', '#>']] };

const types = (text, spec) => extractMarkers(text, spec).map((m) => m.type);
const pairs = (text, spec) => extractMarkers(text, spec).map((m) => [m.type, m.line]);

test('extractMarkers: line comment at the start of a line', () => {
  assert.deepEqual(pairs('// TODO: ship it', JS), [['TODO', 1]]);
});

test('extractMarkers: detects a marker with no trailing punctuation', () => {
  // The keyword is the last thing on the line, with nothing after it.
  assert.deepEqual(types('// TODO', JS), ['TODO']);
});

test('extractMarkers: reports the correct line for a line comment', () => {
  const src = ['const a = 1;', '// FIXME: second line', 'const b = 2;'].join('\n');
  assert.deepEqual(pairs(src, JS), [['FIXME', 2]]);
});

test('extractMarkers: multi-line block comment keeps accurate line numbers', () => {
  const src = ['/*', ' * HACK one', ' * still inside', ' * TODO two', ' */'].join('\n');
  assert.deepEqual(pairs(src, JS), [['HACK', 2], ['TODO', 4]]);
});

test('extractMarkers: marker on the same line a block comment opens', () => {
  assert.deepEqual(pairs('/* BUG right here */', JS), [['BUG', 1]]);
});

test('extractMarkers: unterminated block comment still reports', () => {
  assert.deepEqual(types('/* TODO never closed', JS), ['TODO']);
});

test('extractMarkers: ignores markers inside a double-quoted string', () => {
  assert.deepEqual(types('const s = "// FIXME";', JS), []);
});

test('extractMarkers: ignores markers inside a single-quoted string', () => {
  assert.deepEqual(types("const s = '/* HACK */';", JS), []);
});

test('extractMarkers: ignores markers inside a template literal', () => {
  const src = ['const s = `', '// TODO inside a template', '`;'].join('\n');
  assert.deepEqual(types(src, JS), []);
});

test('extractMarkers: ignores an escaped quote without ending the string', () => {
  assert.deepEqual(types('const s = "he said \\"// TODO\\"";', JS), []);
});

test('extractMarkers: returns nothing when no keyword appears in a comment', () => {
  assert.deepEqual(types('// a perfectly ordinary comment', JS), []);
});

test('extractMarkers: handles a line comment after code', () => {
  assert.deepEqual(pairs('const real = 1; // TODO real one', JS), [['TODO', 1]]);
});

test('extractMarkers: hash-style line comments', () => {
  assert.deepEqual(pairs('# TODO a', HASH), [['TODO', 1]]);
  assert.deepEqual(types('x = "# FIXME"', HASH), []);
});

test('extractMarkers: dash-style line comments', () => {
  assert.deepEqual(pairs('-- BUG a', DASH), [['BUG', 1]]);
});

test('extractMarkers: a comment opener of another language is not a comment', () => {
  // SQL uses `--`; `//` must be treated as ordinary code.
  assert.deepEqual(types('// not a comment TODO', DASH), []);
  assert.deepEqual(pairs('-- real TODO', DASH), [['TODO', 1]]);
  // Both syntaxes together: only the real comment is reported.
  assert.deepEqual(pairs('// ignored TODO\n-- real FIXME', DASH), [['FIXME', 2]]);
});

test('extractMarkers: curly-brace block comments', () => {
  const src = ['-- TODO a', '{- FIXME', '  b -}'].join('\n');
  assert.deepEqual(pairs(src, HASKELL), [['TODO', 1], ['FIXME', 2]]);
});

test('extractMarkers: double-dash block comments', () => {
  assert.deepEqual(pairs('x = 1 --[[ HACK ]] y', LUA), [['HACK', 1]]);
});

test('extractMarkers: powershell block comments', () => {
  assert.deepEqual(pairs('<#\n  TODO a\n#>', POWERSHELL), [['TODO', 2]]);
});

test('extractMarkers: recognises every registered keyword', () => {
  for (const kw of ['TODO', 'FIXME', 'HACK', 'XXX', 'BUG', 'OPTIMIZE', 'REVIEW']) {
    assert.deepEqual(types(`// ${kw} thing`, JS), [kw], `expected ${kw} to be detected`);
  }
});

test('extractMarkers: is case sensitive, so prose is not a marker', () => {
  // Lowercase mentions in ordinary comments should stay quiet.
  assert.deepEqual(types('// this is just a todo list', JS), []);
  assert.deepEqual(types('// Fix the thing properly', JS), []);
});

test('extractMarkers: does not match a keyword embedded in a longer word', () => {
  assert.deepEqual(types('// TODOING is not a marker word', JS), []);
  assert.deepEqual(types('// METHODS are fine', JS), []);
});

test('extractMarkers: returns an empty array for a spec with no line comment', () => {
  assert.deepEqual(types('anything at all', { line: null, block: [] }), []);
});

test('extractMarkers: counts multiple markers on one line', () => {
  assert.deepEqual(types('// TODO and FIXME', JS), ['TODO', 'FIXME']);
});

test('extractSecrets: finds an AWS access key id', () => {
  const hits = extractSecrets('const k = "AKIAIOSFODNN7EXAMPLE";');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, 'AWS access key id');
});

test('extractSecrets: reports the line number of a secret', () => {
  const src = ['const a = 1;', 'const k = "AKIAIOSFODNN7EXAMPLE";'].join('\n');
  const [hit] = extractSecrets(src);
  assert.equal(hit.line, 2);
});

test('extractSecrets: redacts the value it reports', () => {
  const [hit] = extractSecrets('k = "AKIAIOSFODNN7EXAMPLE"');
  assert.match(hit.preview, /AKIA\*+MPLE/);
  assert.ok(!hit.preview.includes('IOSFODNN7'), 'must not echo the credential body');
});

test('extractSecrets: redacts very short values entirely', () => {
  const [hit] = extractSecrets('k = "AKIAIOSFODNN7EXAMPLE"');
  assert.ok(hit.preview.length <= 64);
});

test('extractSecrets: detects a GitHub token', () => {
  const hits = extractSecrets('token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789"');
  assert.equal(hits[0].kind, 'GitHub token');
});

test('extractSecrets: detects a private key block header', () => {
  const hits = extractSecrets('-----BEGIN RSA PRIVATE KEY-----');
  assert.equal(hits[0].kind, 'private key block');
});

test('extractSecrets: detects a connection string with an inline password', () => {
  const hits = extractSecrets('DATABASE_URL=postgres://admin:hunter2@prod:5432/db');
  assert.equal(hits[0].kind, 'connection string with password');
});

test('extractSecrets: detects a JSON web token', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r';
  assert.equal(extractSecrets(`t = "${jwt}"`)[0].kind, 'JSON Web Token');
});

test('extractSecrets: detects a secret assignment by name', () => {
  const hits = extractSecrets('api_key = "s3cr3tvaluegoeshere"');
  assert.equal(hits[0].kind, 'hardcoded secret assignment');
});

test('extractSecrets: ignores well-known placeholder values', () => {
  for (const value of ['your_api_key', 'changeme', 'placeholder', 'dummy']) {
    assert.equal(extractSecrets(`api_key = "${value}"`).length, 0, `${value} should be ignored`);
  }
});

test('extractSecrets: ignores a short value after a secret-looking name', () => {
  assert.equal(extractSecrets('token = "short"').length, 0);
});

test('extractSecrets: does not fire on an ordinary key name', () => {
  assert.equal(extractSecrets('const keynote = "not a credential"').length, 0);
});

test('extractSecrets: ignores a bare variable named password with no value', () => {
  assert.equal(extractSecrets('const password = getPassword();').length, 0);
});

test('extractSecrets: returns nothing for clean text', () => {
  assert.deepEqual(extractSecrets('const total = a + b;'), []);
});

test('SECRET_PATTERNS: every entry declares a usable capture group', () => {
  for (const { kind, re, group } of SECRET_PATTERNS) {
    assert.equal(typeof kind, 'string', 'entry needs a kind');
    assert.ok(re instanceof RegExp, `${kind} needs a RegExp`);
    assert.ok(Number.isInteger(group), `${kind} needs an integer group`);
    assert.ok(group >= 0, `${kind} group must not be negative`);
  }
});

test('SECRET_PATTERNS: no duplicate kinds', () => {
  const kinds = SECRET_PATTERNS.map((p) => p.kind);
  assert.equal(new Set(kinds).size, kinds.length);
});

const rec = (over) => ({
  abs: '/tmp/x',
  rel: 'src/x.ts',
  name: 'x.ts',
  ext: '.ts',
  size: 100,
  depth: 1,
  lang: 'typescript',
  langVia: 'ext',
  isBinary: false,
  isGenerated: false,
  isLockfile: false,
  ...over,
});

test('isSource: a normal source file counts', () => {
  assert.equal(isSource(rec({})), true);
});

test('isSource: a file with no recognized language does not count', () => {
  assert.equal(isSource(rec({ lang: null })), false);
});

test('isSource: a manifest matched by filename does not count', () => {
  // requirements.txt resolves to python by name, but it is not source code.
  assert.equal(isSource(rec({ rel: 'requirements.txt', name: 'requirements.txt', ext: '.txt', lang: 'python', langVia: 'filename' })), false);
  assert.equal(isSource(rec({ rel: 'Makefile', name: 'Makefile', ext: '', lang: 'c', langVia: 'filename' })), false);
});

test('isSource: binaries, generated files and lockfiles are excluded', () => {
  assert.equal(isSource(rec({ isBinary: true })), false);
  assert.equal(isSource(rec({ isGenerated: true })), false);
  assert.equal(isSource(rec({ isLockfile: true })), false);
});

test('isLineStructured: a notebook is not line structured', () => {
  // Notebooks are JSON, so checks that work by lines are meaningless on them.
  assert.equal(isSource(rec({ lang: 'notebook' })), true);
  assert.equal(isLineStructured(rec({ lang: 'notebook' })), false);
});

test('isLineStructured: ordinary source is line structured', () => {
  assert.equal(isLineStructured(rec({})), true);
});

function withTempFile(contents, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'flamer-scan-'));
  try {
    const abs = join(dir, 'sample.ts');
    writeFileSync(abs, contents);
    return fn(abs);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('scanFile: counts lines and records the language', () => {
  withTempFile('const a = 1;\nconst b = 2;\n', (abs) => {
    const out = scanFile({ abs, rel: 'sample.ts', name: 'sample.ts', ext: '.ts', size: 26, depth: 1 });
    assert.equal(out.lang, 'typescript');
    assert.equal(out.langVia, 'ext');
    assert.equal(out.lines, 2);
  });
});

test('scanFile: counts a final line with no trailing newline', () => {
  withTempFile('const a = 1;', (abs) => {
    const out = scanFile({ abs, rel: 'sample.ts', name: 'sample.ts', ext: '.ts', size: 12, depth: 1 });
    assert.equal(out.lines, 1);
    assert.equal(out.noTrailingNewline, true);
  });
});

test('scanFile: marks a zero-byte file as empty without reading it', () => {
  withTempFile('', (abs) => {
    const out = scanFile({ abs, rel: 'sample.ts', name: 'sample.ts', ext: '.ts', size: 0, depth: 1 });
    assert.equal(out.empty, true);
    assert.equal(out.lines, 0);
  });
});

test('scanFile: detects CRLF line endings', () => {
  withTempFile('const a = 1;\r\nconst b = 2;\r\n', (abs) => {
    const out = scanFile({ abs, rel: 'sample.ts', name: 'sample.ts', ext: '.ts', size: 28, depth: 1 });
    assert.equal(out.crlf, true);
  });
});

test('scanFile: counts lines longer than 200 columns', () => {
  withTempFile(`const wide = "${'x'.repeat(250)}";\n`, (abs) => {
    const out = scanFile({ abs, rel: 'sample.ts', name: 'sample.ts', ext: '.ts', size: 270, depth: 1 });
    assert.equal(out.longLines, 1);
    assert.ok(out.maxLine > 200);
  });
});

test('scanFile: finds merge conflict markers', () => {
  const src = ['const a = 1;', '<<<<<<< HEAD', 'const b = 2;', '=======', 'const b = 3;', '>>>>>>> other'].join('\n');
  withTempFile(src, (abs) => {
    const out = scanFile({ abs, rel: 'sample.ts', name: 'sample.ts', ext: '.ts', size: src.length, depth: 1 });
    assert.deepEqual(out.conflictLines, [2, 4, 6]);
  });
});

test('scanFile: a clean file reports no conflicts', () => {
  withTempFile('const a = 1;\n', (abs) => {
    const out = scanFile({ abs, rel: 'sample.ts', name: 'sample.ts', ext: '.ts', size: 13, depth: 1 });
    assert.deepEqual(out.conflictLines, []);
  });
});

test('scanFile: collects comment markers from the file', () => {
  withTempFile('// TODO: something\nconst a = 1;\n', (abs) => {
    const out = scanFile({ abs, rel: 'sample.ts', name: 'sample.ts', ext: '.ts', size: 35, depth: 1 });
    assert.deepEqual(out.markers.map((m) => m.type), ['TODO']);
  });
});

test('scanFile: detects a shebang', () => {
  withTempFile('#!/usr/bin/env node\nconsole.log(1);\n', (abs) => {
    const out = scanFile({ abs, rel: 'sample.ts', name: 'sample.ts', ext: '.ts', size: 33, depth: 1 });
    assert.equal(out.hasShebang, true);
  });
});

test('scanFile: flags a generated file by name', () => {
  withTempFile('export const x = 1;\n', (abs) => {
    const out = scanFile({ abs, rel: 'x.generated.ts', name: 'x.generated.ts', ext: '.ts', size: 19, depth: 1 });
    assert.equal(out.isGenerated, true);
  });
});

test('scanFile: flags a lockfile by name', () => {
  withTempFile('{}\n', (abs) => {
    const out = scanFile({ abs, rel: 'package-lock.json', name: 'package-lock.json', ext: '.json', size: 3, depth: 1 });
    assert.equal(out.isLockfile, true);
  });
});

test('scanFile: marks binary content and reads no further', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flamer-bin-'));
  try {
    const abs = join(dir, 'blob.js');
    const bytes = Buffer.alloc(2048);
    bytes.write('\x00\x01\x02\x03', 0, 'binary');
    writeFileSync(abs, bytes);
    const out = scanFile({ abs, rel: 'blob.js', name: 'blob.js', ext: '.js', size: bytes.length, depth: 1 });
    assert.equal(out.isBinary, true);
    assert.equal(out.lines, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scanFile: tolerates a file that does not exist', () => {
  const out = scanFile({ abs: '/definitely/not/here.ts', rel: 'here.ts', name: 'here.ts', ext: '.ts', size: 50, depth: 1 });
  assert.equal(out.lines, 0);
  assert.equal(out.isBinary, false);
});
