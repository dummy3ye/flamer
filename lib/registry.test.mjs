import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LANGUAGES,
  EXT_MAP,
  matchLang,
  languageById,
  allExtensions,
  FILENAME_MAP,
} from './registry.mjs';

test('registry: every language entry is well formed', () => {
  for (const l of LANGUAGES) {
    assert.equal(typeof l.id, 'string', 'id must be a string');
    assert.equal(typeof l.label, 'string', `${l.id}: label must be a string`);
    assert.ok(Array.isArray(l.exts) && l.exts.length > 0, `${l.id}: needs extensions`);
    // An empty test list is legitimate for config/data formats (docker,
    // terraform, notebooks) that have no filename convention for tests.
    assert.ok(Array.isArray(l.tests), `${l.id}: tests must be an array`);
    assert.ok(l.comment?.line, `${l.id}: needs a line comment marker`);
    assert.ok(l.bloat?.soft > 0 && l.bloat?.hard > 0, `${l.id}: needs bloat limits`);
    assert.ok(l.bloat.soft <= l.bloat.hard, `${l.id}: soft limit must not exceed hard limit`);
  }
});

test('registry: language ids are unique', () => {
  const ids = LANGUAGES.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('registry: every declared extension is normalized to lowercase and dotted', () => {
  for (const l of LANGUAGES) {
    for (const ext of l.exts) {
      assert.match(ext, /^\.[a-z0-9.+]+$/i, `${l.id}: bad extension "${ext}"`);
    }
  }
});

test('registry: no extension is claimed by two languages', () => {
  // EXT_MAP is the first entry wins, so a duplicate would silently shadow a language.
  const seen = new Map();
  for (const l of LANGUAGES) {
    for (const ext of l.exts) {
      assert.equal(seen.has(ext), false, `extension ${ext} claimed by both ${seen.get(ext)} and ${l.id}`);
      seen.set(ext, l.id);
    }
  }
});

test('registry: EXT_MAP and FILENAME_MAP agree with the language table', () => {
  for (const [ext, id] of EXT_MAP) assert.ok(languageById(id), `${ext} maps to unknown language ${id}`);
  for (const [name, id] of FILENAME_MAP) assert.ok(languageById(id), `${name} maps to unknown language ${id}`);
});

test('registry: every test pattern is a real expression', () => {
  for (const l of LANGUAGES) {
    for (const re of l.tests) assert.ok(re instanceof RegExp, `${l.id}: test pattern is not a RegExp`);
  }
});

test('registry: allExtensions is sorted and non-empty', () => {
  const exts = allExtensions();
  assert.ok(exts.length > 0);
  assert.deepEqual(exts, [...exts].sort());
});

const expectExt = (rel, id) => {
  const m = matchLang(rel);
  assert.equal(m.lang?.id, id, `${rel} should resolve to ${id}`);
  assert.equal(m.via, 'ext');
};

const expectFilename = (rel, id) => {
  const m = matchLang(rel);
  assert.equal(m.lang?.id, id, `${rel} should resolve to ${id}`);
  assert.equal(m.via, 'filename');
};

const expectNone = (rel) => {
  const m = matchLang(rel);
  assert.equal(m.lang, null, `${rel} should not resolve to a language`);
  assert.equal(m.via, null);
};

test('matchLang: resolves mainstream extensions', () => {
  expectExt('src/main.rs', 'rust');
  expectExt('a.py', 'python');
  expectExt('b.tf', 'terraform');
  expectExt('c.ts', 'typescript');
  expectExt('c.tsx', 'typescript');
  expectExt('d.go', 'go');
  expectExt('e.java', 'java');
  expectExt('f.cs', 'csharp');
  expectExt('g.rb', 'ruby');
  expectExt('h.php', 'php');
  expectExt('i.sh', 'shell');
  expectExt('j.swift', 'swift');
  expectExt('k.dart', 'dart');
  expectExt('l.hs', 'haskell');
  expectExt('m.ex', 'elixir');
  expectExt('n.lua', 'lua');
  expectExt('o.sol', 'solidity');
  expectExt('p.zig', 'zig');
  expectExt('q.sql', 'sql');
  expectExt('r.ipynb', 'notebook');
});

test('matchLang: resolves c and c++ separately', () => {
  expectExt('legacy.c', 'c');
  expectExt('legacy.h', 'c');
  expectExt('impl.cpp', 'cpp');
  expectExt('impl.hpp', 'cpp');
});

test('matchLang: handles depth and multiple dots', () => {
  expectExt('packages/api/src/handler.ts', 'typescript');
  expectExt('lib/vendor/thing.min.js', 'javascript');
  expectExt('src/a.b.c.py', 'python');
});

test('matchLang: is case insensitive on the extension', () => {
  expectExt('A.PY', 'python');
  expectExt('B.RS', 'rust');
});

test('matchLang: resolves manifests by filename, not extension', () => {
  expectFilename('requirements.txt', 'python');
  expectFilename('pyproject.toml', 'python');
  expectFilename('Cargo.toml', 'rust');
  expectFilename('go.mod', 'go');
  expectFilename('package.json', 'javascript');
  expectFilename('tsconfig.json', 'typescript');
  expectFilename('Dockerfile', 'docker');
});

test('matchLang: a manifest at depth still resolves by name', () => {
  expectFilename('packages/api/package.json', 'javascript');
  expectFilename('deep/nested/Cargo.toml', 'rust');
});

test('matchLang: returns nothing for an unknown extension', () => {
  expectNone('image.png');
  expectNone('data.csv');
  expectNone('notes.docx');
  expectNone('Makefile.am');
});

test('matchLang: a dotfile with no extension does not resolve', () => {
  expectNone('.env');
  expectNone('.gitignore');
});

test('matchLang: a leading-dot file is not treated as an extension', () => {
  // ".env" must not be read as an extension of an empty basename.
  expectNone('.env');
  expectNone('.npmrc');
});

test('languageById: returns the entry for a known id', () => {
  assert.equal(languageById('rust').label, 'Rust');
  assert.equal(languageById('terraform').id, 'terraform');
});

test('languageById: returns null for an unknown id', () => {
  assert.equal(languageById('cobol'), null);
  assert.equal(languageById(''), null);
  assert.equal(languageById(undefined), null);
});

test('registry: executable languages all declare test patterns', () => {
  // Only these may have an empty list; the test ratio analyzer skips exactly them.
  const mayBeEmpty = new Set(['docker', 'terraform', 'notebook', 'sql']);
  for (const l of LANGUAGES) {
    if (mayBeEmpty.has(l.id)) continue;
    assert.ok(l.tests.length > 0, `${l.id} should declare test patterns`);
  }
});

test('registry: covers the languages the skill advertises', () => {
  // These are the ecosystems named in SKILL.md; dropping one is a doc bug.
  for (const id of [
    'javascript', 'typescript', 'python', 'rust', 'go', 'c', 'cpp', 'csharp',
    'java', 'ruby', 'php', 'shell', 'powershell', 'sql', 'terraform', 'docker',
    'notebook', 'swift', 'dart', 'haskell', 'elixir', 'lua', 'r', 'solidity', 'zig',
  ]) {
    assert.ok(languageById(id), `advertised language "${id}" is missing from the registry`);
  }
});
