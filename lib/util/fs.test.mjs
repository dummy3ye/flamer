import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  walkTree,
  looksBinary,
  readText,
  readJSON,
  isGeneratedName,
  DEFAULT_IGNORE_DIRS,
  LOCKFILES,
} from './fs.mjs';

/** Build a throwaway tree from a path -> content map. */
function withTree(spec, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'flamer-fs-'));
  try {
    for (const [rel, content] of Object.entries(spec)) {
      const abs = join(dir, rel);
      mkdirSync(join(abs, '..'), { recursive: true });
      if (content === null) mkdirSync(abs, { recursive: true });
      else writeFileSync(abs, content);
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const rels = (dir) => walkTree(dir).files.map((f) => f.rel).sort();

test('walkTree: finds files at several depths', () => {
  withTree({ 'a.js': '', 'src/b.js': '', 'src/deep/c.js': '' }, (dir) => {
    assert.deepEqual(rels(dir), ['a.js', 'src/b.js', 'src/deep/c.js']);
  });
});

test('walkTree: skips node_modules at any depth', () => {
  withTree({ 'a.js': '', 'node_modules/x/index.js': '', 'src/node_modules/y.js': '' }, (dir) => {
    assert.deepEqual(rels(dir), ['a.js']);
  });
});

test('walkTree: skips build output directories', () => {
  withTree({ 'a.js': '', 'dist/b.js': '', 'build/c.js': '', 'out/d.js': '', 'coverage/e.js': '' }, (dir) => {
    assert.deepEqual(rels(dir), ['a.js']);
  });
});

test('walkTree: skips language-specific build directories', () => {
  withTree({ 'a.py': '', 'target/b.rs': '', '__pycache__/c.py': '', '.venv/d.py': '', 'obj/e.cs': '' }, (dir) => {
    assert.deepEqual(rels(dir), ['a.py']);
  });
});

test('walkTree: descends into .github because it holds CI config', () => {
  withTree({ '.github/workflows/ci.yml': '' }, (dir) => {
    assert.deepEqual(rels(dir), ['.github/workflows/ci.yml']);
  });
});

test('walkTree: skips other hidden directories', () => {
  withTree({ 'a.js': '', '.vscode/settings.json': '' }, (dir) => {
    assert.deepEqual(rels(dir), ['a.js']);
  });
});

test('walkTree: still reports root-level dotfiles', () => {
  // A committed .env is exactly the kind of thing an audit must surface.
  withTree({ 'a.js': '', '.env': 'SECRET=1', '.gitignore': 'node_modules/' }, (dir) => {
    assert.deepEqual(rels(dir), ['.env', '.gitignore', 'a.js']);
  });
});

test('walkTree: records size, depth and extension', () => {
  withTree({ 'a.js': 'x'.repeat(10) }, (dir) => {
    const [f] = walkTree(dir).files;
    assert.equal(f.size, 10);
    assert.equal(f.depth, 0);
    assert.equal(f.ext, '.js');
    assert.equal(f.name, 'a.js');
  });
});

test('walkTree: honours extraIgnores', () => {
  withTree({ 'a.js': '', 'keepme/b.js': '' }, (dir) => {
    const { files } = walkTree(dir, { extraIgnores: new Set(['keepme']) });
    assert.deepEqual(files.map((f) => f.rel), ['a.js']);
  });
});

test('walkTree: does not follow a symlink loop by default', () => {
  withTree({ 'a.js': '', 'sub/b.js': '' }, (dir) => {
    symlinkSync(dir, join(dir, 'sub', 'loop'));
    const { files } = walkTree(dir);
    assert.deepEqual(files.map((f) => f.rel).sort(), ['a.js', 'sub/b.js']);
  });
});

test('walkTree: survives a broken symlink', () => {
  withTree({ 'a.js': '' }, (dir) => {
    symlinkSync(join(dir, 'does-not-exist'), join(dir, 'broken'));
    assert.deepEqual(rels(dir), ['a.js']);
  });
});

test('walkTree: calls onFile for each record', () => {
  withTree({ 'a.js': '', 'b/c.js': '' }, (dir) => {
    const seen = [];
    walkTree(dir, { onFile: (r) => seen.push(r.rel) });
    assert.deepEqual(seen.sort(), ['a.js', 'b/c.js']);
  });
});

test('walkTree: reports directories encountered', () => {
  withTree({ 'src/deep/a.js': '' }, (dir) => {
    assert.deepEqual(walkTree(dir).dirs.sort(), ['src', 'src/deep']);
  });
});

test('walkTree: an empty directory yields nothing and does not throw', () => {
  withTree({ 'empty/': null }, (dir) => {
    const { files, dirs } = walkTree(dir);
    assert.deepEqual(files, []);
    assert.deepEqual(dirs, ['empty']);
  });
});

test('walkTree: lib is not ignored, because it is often source', () => {
  assert.equal(DEFAULT_IGNORE_DIRS.has('lib'), false);
  withTree({ 'lib/util/a.js': '' }, (dir) => {
    assert.deepEqual(rels(dir), ['lib/util/a.js']);
  });
});

test('looksBinary: plain text is not binary', () => {
  assert.equal(looksBinary(Buffer.from('const a = 1;\n')), false);
  assert.equal(looksBinary(Buffer.from('')), false);
});

test('looksBinary: a NUL byte marks it binary', () => {
  assert.equal(looksBinary(Buffer.from([0x61, 0x62, 0x00, 0x63])), true);
});

test('looksBinary: mostly non-printable bytes mark it binary', () => {
  assert.equal(looksBinary(Buffer.alloc(1024, 0x01)), true);
});

test('looksBinary: tab, newline and carriage return are allowed', () => {
  assert.equal(looksBinary(Buffer.from('a\tb\nc\r\nd')), false);
});

test('looksBinary: a mostly-UTF8 file stays text', () => {
  // Regression: multibyte characters are mostly bytes > 126, so a naive
  // byte count heuristic classified real source as binary and dropped it
  // from the audit entirely.
  assert.equal(looksBinary(Buffer.from('// héllo wörld — ünïcodé\n')), false);
  assert.equal(looksBinary(Buffer.from('const grüß = "日本語のテキスト";\n')), false);
  assert.equal(looksBinary(Buffer.from('// emoji in a comment 🎉🔥\n')), false);
  assert.equal(looksBinary(Buffer.from('#!/usr/bin/env node\n// → ← ↔\n')), false);
});

test('looksBinary: handles UTF-8 text longer than the sample window', () => {
  // A multibyte character can straddle the 4096-byte boundary; that must not
  // make an otherwise valid text file look binary.
  const line = 'héllo wörld — ünïcodé 日本語\n';
  const big = line.repeat(Math.ceil(4200 / line.length));
  assert.ok(big.length > 4096);
  assert.equal(looksBinary(Buffer.from(big)), false);
});

test('looksBinary: still rejects real binary data', () => {
  // High bytes that are not valid UTF-8, in bulk.
  const latinish = Buffer.from(Array.from({ length: 1024 }, (_, i) => 0x80 + (i % 64)));
  assert.equal(looksBinary(latinish), true);
});

test('looksBinary: control characters that are valid single-byte UTF-8 are still caught', () => {
  // 0x01 decodes cleanly as U+0001, so UTF-8 validity alone is not enough to
  // clear a file. A buffer of control bytes must still read as binary.
  assert.equal(looksBinary(Buffer.alloc(1024, 0x01)), true);
  assert.equal(looksBinary(Buffer.alloc(1024, 0x1b)), true);
});

test('looksBinary: a real image blob is rejected', () => {
  // Build something with the shape of compressed data: high entropy, control
  // bytes, and invalid UTF-8 sequences.
  const blob = Buffer.alloc(2048);
  for (let i = 0; i < blob.length; i++) blob[i] = (i * 73 + 41) % 256;
  assert.equal(looksBinary(blob), true);
});

test('isGeneratedName: detects minified and bundled output', () => {
  assert.equal(isGeneratedName('bundle.min.js'), true);
  assert.equal(isGeneratedName('app.min.css'), true);
  assert.equal(isGeneratedName('vendor.js.map'), true);
});

test('isGeneratedName: detects generated-suffixed files', () => {
  assert.equal(isGeneratedName('schema_pb2.py'), true);
  assert.equal(isGeneratedName('api.pb.go'), true);
  assert.equal(isGeneratedName('Widget.designer.cs'), true);
  assert.equal(isGeneratedName('types.d.ts'), true);
});

test('isGeneratedName: detects generated directory names', () => {
  assert.equal(isGeneratedName('__generated__'), true);
  assert.equal(isGeneratedName('api.gen.go'), true);
  assert.equal(isGeneratedName('autogen_types.ts'), true);
});

test('isGeneratedName: leaves ordinary source alone', () => {
  assert.equal(isGeneratedName('index.ts'), false);
  assert.equal(isGeneratedName('main.rs'), false);
  assert.equal(isGeneratedName('README.md'), false);
  // A word merely containing "gen" is not generated.
  assert.equal(isGeneratedName('general.ts'), false);
});

test('readText: returns contents of an existing file', () => {
  withTree({ 'a.txt': 'hello' }, (dir) => {
    assert.equal(readText(join(dir, 'a.txt')), 'hello');
  });
});

test('readText: returns an empty string for a missing file', () => {
  assert.equal(readText('/definitely/not/here.txt'), '');
});

test('readJSON: parses valid JSON', () => {
  withTree({ 'a.json': '{"k":1}' }, (dir) => {
    assert.deepEqual(readJSON(join(dir, 'a.json')), { k: 1 });
  });
});

test('readJSON: returns null for malformed JSON rather than throwing', () => {
  withTree({ 'bad.json': '{oops' }, (dir) => {
    assert.equal(readJSON(join(dir, 'bad.json')), null);
  });
});

test('readJSON: returns null for a missing file', () => {
  assert.equal(readJSON('/definitely/not/here.json'), null);
});

test('LOCKFILES: recognizes lockfiles across ecosystems', () => {
  for (const f of ['package-lock.json', 'yarn.lock', 'poetry.lock', 'Cargo.lock', 'go.sum', 'Gemfile.lock', 'composer.lock', 'mix.lock', 'pubspec.lock']) {
    assert.equal(LOCKFILES.has(f), true, `${f} should be a known lockfile`);
  }
});
