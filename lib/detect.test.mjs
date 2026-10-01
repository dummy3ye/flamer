import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { detectScopes, buildProfile, projectKind } from './detect.mjs';
import { walkTree } from './util/fs.mjs';
import { scanFile, isSource } from './scan.mjs';

/** Materialize a temp repo from a path -> content map. */
function withRepo(spec, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'flamer-detect-'));
  try {
    for (const [rel, content] of Object.entries(spec)) {
      const abs = join(dir, rel);
      mkdirSync(abs.slice(0, abs.lastIndexOf('/')), { recursive: true });
      if (content === null) mkdirSync(abs, { recursive: true });
      else writeFileSync(abs, content);
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const PKG = (name) => JSON.stringify({ name, version: '1.0.0' });

test('detectScopes: a single package at the root', () => {
  withRepo({ 'package.json': PKG('solo') }, (dir) => {
    const { layout, scopes } = detectScopes(dir);
    assert.equal(layout, 'single');
    assert.equal(scopes.length, 1);
    assert.equal(scopes[0].isRoot, true);
  });
});

test('detectScopes: a packages/ monorepo', () => {
  withRepo({
    'package.json': PKG('root'),
    'packages/api/package.json': PKG('@x/api'),
    'packages/web/package.json': PKG('@x/web'),
  }, (dir) => {
    const { layout, scopes } = detectScopes(dir);
    assert.equal(layout, 'monorepo');
    const names = scopes.map((s) => s.name);
    assert.ok(names.includes('api'));
    assert.ok(names.includes('web'));
    assert.ok(names.includes('root') || scopes.some((s) => s.isRoot));
  });
});

test('detectScopes: recognizes an apps/ directory too', () => {
  withRepo({
    'package.json': PKG('root'),
    'apps/site/package.json': PKG('@x/site'),
  }, (dir) => {
    assert.equal(detectScopes(dir).layout, 'monorepo');
  });
});

test('detectScopes: finds a cargo workspace of crates', () => {
  withRepo({
    'Cargo.toml': '[workspace]\nmembers = ["crates/a"]\n',
    'crates/a/Cargo.toml': '[package]\nname = "a"\n',
  }, (dir) => {
    const { scopes } = detectScopes(dir);
    assert.ok(scopes.some((s) => s.name === 'a'), 'crate a should be a scope');
  });
});

test('detectScopes: ignores directories with no manifest', () => {
  withRepo({
    'package.json': PKG('root'),
    'packages/notapkg/readme.md': 'hello',
  }, (dir) => {
    const { scopes } = detectScopes(dir);
    assert.equal(scopes.some((s) => s.name === 'notapkg'), false);
  });
});

test('detectScopes: detects a .NET solution', () => {
  withRepo({ 'App.sln': 'solution', 'src/App.csproj': '<Project/>' }, (dir) => {
    const { scopes } = detectScopes(dir);
    assert.ok(scopes.some((s) => s.path === 'src'), 'a directory holding a csproj is a scope');
  });
});

test('detectScopes: records lockfiles it finds', () => {
  withRepo({ 'package.json': PKG('x'), 'package-lock.json': '{}' }, (dir) => {
    const { scopes } = detectScopes(dir);
    assert.ok(scopes[0].lockfiles.includes('package-lock.json'));
  });
});

/** Walk a temp repo the same way flamer.mjs does, to build a file set. */
function filesOf(dir) {
  const files = [];
  walkTree(dir, { onFile: (r) => files.push(scanFile(r)) });
  return files;
}

function profileOf(dir, files = filesOf(dir)) {
  return buildProfile(dir, detectScopes(dir), files);
}

test('buildProfile: infers a language from a manifest with no source yet', () => {
  withRepo({ 'Cargo.toml': '[package]\nname="x"\n' }, (dir) => {
    const p = profileOf(dir, []);
    assert.equal(p.ecosystemLangs.includes('rust'), true);
    assert.ok(p.languages.some((l) => l.id === 'rust'));
  });
});

test('buildProfile: reports the dominant language by file count', () => {
  withRepo({
    'package.json': PKG('x'),
    'a.ts': 'export const a = 1;\n',
    'b.ts': 'export const b = 2;\n',
    'c.py': 'x = 1\n',
  }, (dir) => {
    const p = profileOf(dir);
    assert.equal(p.dominantLanguage, 'typescript');
  });
});

test('buildProfile: detects the node ecosystem', () => {
  withRepo({ 'package.json': PKG('x') }, (dir) => {
    const p = profileOf(dir, []);
    assert.equal(p.tooling.isNode, true);
    assert.equal(p.tooling.isPython, false);
  });
});

test('buildProfile: detects the python ecosystem from requirements.txt', () => {
  withRepo({ 'requirements.txt': 'flask\n' }, (dir) => {
    assert.equal(profileOf(dir, []).tooling.isPython, true);
  });
});

test('buildProfile: notices a gitignore', () => {
  withRepo({ '.gitignore': 'node_modules/', 'package.json': PKG('x') }, (dir) => {
    assert.equal(profileOf(dir, []).tooling.hasGitignore, true);
  });
});

test('buildProfile: notices a README regardless of case or suffix', () => {
  for (const name of ['README.md', 'readme.md', 'README.rst', 'README']) {
    withRepo({ [name]: 'hi' }, (dir) => {
      assert.equal(profileOf(dir, []).tooling.hasReadme, true, `${name} should count`);
    });
  }
});

test('buildProfile: notices a license file', () => {
  withRepo({ LICENSE: 'MIT' }, (dir) => {
    assert.equal(profileOf(dir, []).tooling.hasLicense, true);
  });
});

test('buildProfile: notices CI configuration', () => {
  withRepo({ '.github/workflows/ci.yml': 'on: push' }, (dir) => {
    assert.equal(profileOf(dir, []).tooling.hasCi, true);
  });
});

test('buildProfile: an empty repo has no tooling flags set', () => {
  withRepo({ 'a.ts': 'export const a = 1;\n' }, (dir) => {
    const t = profileOf(dir).tooling;
    assert.equal(t.hasReadme, false);
    assert.equal(t.hasLicense, false);
    assert.equal(t.hasGitignore, false);
    assert.equal(t.hasCi, false);
  });
});

test('buildProfile: an .env with no example is flagged by the tooling flags', () => {
  withRepo({ '.env': 'A=1' }, (dir) => {
    const t = profileOf(dir, []).tooling;
    assert.equal(t.hasEnv, true);
    assert.equal(t.hasEnvExample, false);
  });
});

test('projectKind: names the ecosystems it detected', () => {
  withRepo({ 'package.json': PKG('x'), 'requirements.txt': 'flask\n' }, (dir) => {
    const kind = projectKind(profileOf(dir, []));
    assert.ok(kind.includes('node'));
    assert.ok(kind.includes('python'));
  });
});

test('projectKind: a polyglot repo reports several kinds', () => {
  withRepo({ 'Cargo.toml': '[package]\n', 'go.mod': 'module x\n' }, (dir) => {
    const kind = projectKind(profileOf(dir, []));
    assert.ok(kind.includes('rust'));
    assert.ok(kind.includes('go'));
  });
});

test('projectKind: falls back to the dominant language', () => {
  withRepo({ 'a.sql': 'SELECT 1;\n' }, (dir) => {
    assert.deepEqual(projectKind(profileOf(dir)), ['sql']);
  });
});

test('projectKind: an empty repo is reported as unknown', () => {
  withRepo({ 'notes.txt': 'hi' }, (dir) => {
    assert.deepEqual(projectKind(profileOf(dir, [])), ['unknown']);
  });
});

test('buildProfile: is consistent with the scanner on a real tree', () => {
  withRepo({
    'package.json': PKG('x'),
    'src/index.ts': 'export const x = 1;\n',
    'src/index.test.ts': 'test("x", () => {});\n',
  }, (dir) => {
    const files = filesOf(dir);
    const p = profileOf(dir, files);
    assert.equal(p.dominantLanguage, 'typescript');
    // Manifests resolve by filename, so they must not count as source files.
    const source = files.filter(isSource);
    assert.equal(source.length, 2);
    assert.equal(source.some((f) => f.rel === 'package.json'), false);
  });
});
