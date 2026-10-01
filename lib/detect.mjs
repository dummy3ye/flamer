/**
 * Project layout + ecosystem detection.
 *
 * Works for single package repos, polyglot repos, and monorepos, without
 * assuming a `packages/` directory exists.
 */
import { join } from 'path';
import { existsSync } from 'fs';

import { filesIn, subdirs, isDir, LOCKFILES } from './util/fs.mjs';
import { languageById } from './registry.mjs';

/** Directories that commonly hold subprojects that are versioned separately. */
const MONOREPO_DIRS = [
  'packages', 'apps', 'services', 'libs', 'modules', 'crates',
  'cmd', 'internal', 'projects', 'components', 'plugins', 'extensions', 'workers',
];

/** Files that mark a root as an umbrella build orchestrator. */
const WORKSPACE_MARKERS = [
  'pnpm-workspace.yaml', 'lerna.json', 'nx.json', 'turbo.json', 'rush.json',
  'go.work', 'Cargo.toml', 'package.json', 'pom.xml', 'settings.gradle',
  'build.gradle', 'build.gradle.kts', 'pyproject.toml', 'mix.exs', 'flake.nix',
  'stack.yaml', 'dune-project', 'melange.yaml', 'pubspec.yaml', 'Package.swift',
];

/**
 * @typedef {object} Scope
 * @property {string} name   '' for the root, otherwise the subdir name
 * @property {string} path   path relative to the repo root ('' for root)
 * @property {string} abs    absolute path
 * @property {boolean} isRoot
 * @property {string[]} manifests manifest basenames found in this scope
 * @property {string[]} lockfiles lockfile basenames found in this scope
 * @property {Set<string>} langs language ids present (from manifests, not files)
 */

/** Manifest basenames that indicate a subproject of its own. */
const SCOPE_MANIFESTS = new Set([
  'package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'setup.py',
  'requirements.txt', 'Pipfile', 'composer.json', 'Gemfile', 'pom.xml',
  'build.gradle', 'build.gradle.kts', 'mix.exs', 'pubspec.yaml', 'Package.swift',
  'CMakeLists.txt', 'Makefile', 'deno.json', 'build.zig', 'Package.resolved',
]);

/** True if a directory looks like a subproject of its own. */
function isScopeDir(abs) {
  const names = filesIn(abs);
  for (const n of names) {
    if (SCOPE_MANIFESTS.has(n)) return true;
    if (n === '.csproj' || n === '.sln') return true;
    if (n.endsWith('.csproj') || n.endsWith('.fsproj') || n.endsWith('.vbproj')) return true;
  }
  return false;
}

function describeScope(name, relPath, abs) {
  const names = filesIn(abs);
  const manifests = names.filter((n) => SCOPE_MANIFESTS.has(n) || /\.(csproj|sln|fsproj|vbproj)$/.test(n));
  const lockfiles = names.filter((n) => LOCKFILES.has(n));
  return {
    name,
    path: relPath,
    abs,
    isRoot: relPath === '',
    manifests,
    lockfiles,
  };
}

/**
 * Detect project scopes (root + subprojects).
 * @returns {{ layout: 'single'|'monorepo'|'polyglot'|'flat', scopes: object[] }}
 */
export function detectScopes(root) {
  const scopes = [describeScope('', '', root)];
  const found = new Map();

  for (const dir of MONOREPO_DIRS) {
    const abs = join(root, dir);
    if (!isDir(abs)) continue;
    for (const child of subdirs(abs)) {
      const childAbs = join(abs, child);
      if (!isScopeDir(childAbs)) continue;
      const relPath = `${dir}/${child}`;
      if (!found.has(relPath)) {
        found.set(relPath, describeScope(child, relPath, childAbs));
      }
    }
  }

  for (const child of subdirs(root)) {
    if (MONOREPO_DIRS.includes(child)) continue;
    const childAbs = join(root, child);
    if (isScopeDir(childAbs)) {
      const relPath = child;
      if (!found.has(relPath)) found.set(relPath, describeScope(child, relPath, childAbs));
    }
  }

  const nonRoot = [...found.values()];
  const workspaceMarker = WORKSPACE_MARKERS.some((m) => existsSync(join(root, m)));
  const all = [scopes[0], ...nonRoot];

  let layout = 'flat';
  if (nonRoot.length > 0) layout = 'monorepo';
  else if (workspaceMarker) layout = 'single';

  return { layout, scopes: all };
}

/**
 * Infer which languages an ecosystem marker implies, so the report can say
 * "Rust" for a repo that only has Cargo.toml and no .rs yet.
 */
function langsFromManifest(name) {
  const switchName = name;
  if (switchName === 'package.json') return ['javascript'];
  if (switchName === 'tsconfig.json') return ['typescript'];
  if (switchName === 'Cargo.toml') return ['rust'];
  if (switchName === 'go.mod' || switchName === 'go.work') return ['go'];
  if (['pyproject.toml', 'setup.py', 'requirements.txt', 'Pipfile', 'setup.cfg'].includes(switchName)) return ['python'];
  if (['composer.json'].includes(switchName)) return ['php'];
  if (['Gemfile'].includes(switchName)) return ['ruby'];
  if (['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle'].includes(switchName)) return ['java'];
  if (['mix.exs'].includes(switchName)) return ['elixir'];
  if (['pubspec.yaml'].includes(switchName)) return ['dart'];
  if (['Package.swift'].includes(switchName)) return ['swift'];
  if (['build.zig'].includes(switchName)) return ['zig'];
  if (['CMakeLists.txt'].includes(switchName)) return ['c', 'cpp'];
  if (['Makefile', 'makefile'].includes(switchName)) return ['c', 'cpp'];
  if (['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml'].includes(switchName)) return ['docker'];
  if (name.endsWith('.csproj') || name.endsWith('.sln') || name.endsWith('.fsproj') || name.endsWith('.vbproj')) return ['csharp'];
  if (name.endsWith('.cabal') || name === 'stack.yaml') return ['haskell'];
  if (name === 'DESCRIPTION') return ['r'];
  if (name.endsWith('.rockspec')) return ['ruby'];
  if (name === 'meson.build' || name === 'configure.ac') return ['c', 'cpp'];
  if (name === 'foundry.toml' || name === 'hardhat.config.js' || name === 'hardhat.config.ts') return ['solidity'];
  return [];
}

/**
 * Build a project profile: languages, ecosystems, and layout, derived from
 * both manifests on disk and the source files actually walked.
 *
 * @param {string} root
 * @param {{ scopes: object[] }} detected
 * @param {object[]} files FileRecords from lib/scan.mjs
 */
export function buildProfile(root, detected, files = []) {
  const ecosystemLangs = new Set();
  for (const scope of detected.scopes) {
    for (const manifest of scope.manifests) {
      for (const id of langsFromManifest(manifest)) ecosystemLangs.add(id);
    }
    for (const lock of scope.lockfiles) {
      const id = langsFromManifest(lock);
      if (id.length) ecosystemLangs.add(id[0]);
    }
  }

  // Dominant language is decided by source files only. Counting manifests here
  // would let a package.json outvote the actual code, because it resolves to a
  // language by filename.
  const counts = new Map();
  for (const f of files) {
    if (!f.lang) continue;
    if (f.langVia && f.langVia !== 'ext') continue;
    counts.set(f.lang, (counts.get(f.lang) || 0) + 1);
  }
  const sourceLangs = new Set(counts.keys());

  const allLangs = new Set([...ecosystemLangs, ...sourceLangs]);
  const languages = [...allLangs]
    .map((id) => languageById(id))
    .filter(Boolean)
    .map((l) => ({ id: l.id, label: l.label }));

  let dominant = null;
  let best = 0;
  for (const [id, n] of counts) {
    if (n > best) {
      best = n;
      dominant = id;
    }
  }

  const tooling = {
    hasGitignore: existsSync(join(root, '.gitignore')),
    hasReadme: filesIn(root).some((f) => /^readme(\.|$)/i.test(f)),
    hasLicense: filesIn(root).some((f) => /^(licen[sc]e|copying)(\.|$)/i.test(f)),
    hasEditorconfig: existsSync(join(root, '.editorconfig')),
    hasPreCommit: existsSync(join(root, '.pre-commit-config.yaml')) || isDir(join(root, '.husky')),
    hasCi: isDir(join(root, '.github', 'workflows')) || existsSync(join(root, '.gitlab-ci.yml')) || isDir(join(root, '.circleci')),
    hasDocker: existsSync(join(root, 'Dockerfile')) || filesIn(root).some((f) => /^Dockerfile\./.test(f)) || existsSync(join(root, 'docker-compose.yml')),
    hasEnvExample: filesIn(root).some((f) => f === '.env.example' || f === '.env.sample' || f === '.env.template'),
    hasEnv: existsSync(join(root, '.env')),
    isPython: ecosystemLangs.has('python'),
    isNode: ecosystemLangs.has('javascript') || ecosystemLangs.has('typescript'),
    isRust: ecosystemLangs.has('rust'),
    isGo: ecosystemLangs.has('go'),
    isDotnet: ecosystemLangs.has('csharp'),
    isTerraform: ecosystemLangs.has('terraform'),
  };

  return {
    layout: detected.layout,
    scopes: detected.scopes,
    languages,
    dominantLanguage: dominant,
    ecosystemLangs: [...ecosystemLangs],
    tooling,
  };
}

/** A cheap description of what kind of project this is, for the report. */
export function projectKind(profile) {
  const t = profile.tooling;
  const kinds = [];
  if (t.isNode) kinds.push('node');
  if (t.isPython) kinds.push('python');
  if (t.isRust) kinds.push('rust');
  if (t.isGo) kinds.push('go');
  if (t.isDotnet) kinds.push('dotnet');
  if (t.isTerraform) kinds.push('terraform');
  if (profile.dominantLanguage === 'notebook') kinds.push('notebook');
  if (kinds.length === 0 && profile.dominantLanguage) kinds.push(profile.dominantLanguage);
  if (kinds.length === 0) kinds.push('unknown');
  return kinds;
}
