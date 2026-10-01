/**
 * Project scaffolding and dependency manifest checks that apply across
 * ecosystems, plus the smaller language families (Ruby, PHP, JVM, shell,
 * SQL, Solidity, Haskell, Elixir, Dart, Swift, R, Lua).
 */
import { join } from 'path';
import { finding } from '../util/findings.mjs';
import { readText, readJSON } from '../util/fs.mjs';

function scaffolding(ctx) {
  const out = [];
  const t = ctx.profile.tooling;
  const rootFiles = ctx.rootFileNames;

  if (!t.hasReadme && ctx.sourceFiles.length > 0) {
    out.push(
      finding({
        category: 'vcs',
        severity: 'MEDIUM',
        title: 'No README found',
        detail: 'A repository with no README forces every new contributor to reverse-engineer how to run it.',
      })
    );
  }
  if (!t.hasLicense) {
    out.push(
      finding({
        category: 'vcs',
        severity: 'MEDIUM',
        title: 'No LICENSE file',
        detail: 'No license means nobody may legally use, modify, or redistribute this code.',
      })
    );
  }
  if (!t.hasGitignore && (t.isNode || t.isPython || t.isRust || t.isGo)) {
    out.push(
      finding({
        category: 'vcs',
        severity: 'HIGH',
        title: 'No .gitignore',
        detail: 'A code project with no .gitignore will accumulate build output, virtualenvs, and node_modules as untracked noise.',
      })
    );
  }
  if (!t.hasEditorconfig) {
    out.push(
      finding({
        category: 'hygiene',
        severity: 'LOW',
        title: 'No .editorconfig',
        detail: 'No shared whitespace/encoding standard. Formatting churns between contributors.',
      })
    );
  }
  if (t.hasEnv && !t.hasEnvExample && (t.isNode || t.isPython)) {
    out.push(
      finding({
        category: 'vcs',
        severity: 'MEDIUM',
        title: '.env present but no .env.example',
        detail: 'Documenting required variables (without values) is the cheapest onboarding win available.',
      })
    );
  }
  if (t.isNode && !t.hasCi) {
    out.push(
      finding({
        category: 'build',
        severity: 'MEDIUM',
        title: 'No CI configuration detected',
        detail: 'No .github/workflows, .gitlab-ci.yml, or .circleci. Nothing runs the tests automatically.',
      })
    );
  }
  return out;
}

/** Generic manifest presence checks keyed by ecosystem trigger files. */
function manifests(ctx) {
  const out = [];
  const t = ctx.profile.tooling;
  const has = (f) => ctx.rootFileNames.has(f);

  if (has('Gemfile') && !has('Gemfile.lock')) {
    out.push(
      finding({
        category: 'deps',
        severity: 'MEDIUM',
        title: 'Gemfile present but no Gemfile.lock',
        detail: 'Without the lockfile, gem versions drift between installs.',
        files: ['Gemfile'],
        lang: 'ruby',
      })
    );
  }
  if (has('Gemfile') && !has('.ruby-version')) {
    out.push(
      finding({
        category: 'build',
        severity: 'LOW',
        title: 'No .ruby-version',
        detail: 'Ruby version unpinned.',
        lang: 'ruby',
      })
    );
  }

  if (has('composer.json') && !has('composer.lock')) {
    out.push(
      finding({
        category: 'deps',
        severity: 'MEDIUM',
        title: 'composer.json present but no composer.lock',
        detail: 'No lockfile means dependency versions are not pinned.',
        files: ['composer.json'],
        lang: 'php',
      })
    );
  }
  if (has('composer.json')) {
    const pkg = readJSON(join(ctx.root, 'composer.json'));
    if (pkg && !pkg.require) {
      out.push(
        finding({
          category: 'config',
          severity: 'MEDIUM',
          title: 'composer.json has no "require" section',
          detail: 'A PHP project with no runtime requirements declared.',
          files: ['composer.json'],
          lang: 'php',
        })
      );
    }
  }

  const gradleFiles = ['build.gradle', 'build.gradle.kts'].filter((f) => has(f));
  if (gradleFiles.length > 0 && !has('gradle.lockfile') && !has('gradle/verification-metadata.xml')) {
    out.push(
      finding({
        category: 'deps',
        severity: 'LOW',
        title: 'Gradle build with no dependency locking or verification',
        detail: 'gradle.lockfile or dependency verification metadata pins and checksums your dependencies.',
        files: gradleFiles,
        lang: 'java',
      })
    );
  }

  if (has('Package.swift') && !has('Package.resolved')) {
    out.push(
      finding({
        category: 'deps',
        severity: 'LOW',
        title: 'Swift package with no Package.resolved',
        detail: 'Commit Package.resolved to pin exact dependency versions for apps.',
        files: ['Package.swift'],
        lang: 'swift',
      })
    );
  }

  if (has('mix.exs') && !has('mix.lock')) {
    out.push(
      finding({
        category: 'deps',
        severity: 'MEDIUM',
        title: 'mix.exs present but no mix.lock',
        detail: 'No lockfile for hex dependencies.',
        files: ['mix.exs'],
        lang: 'elixir',
      })
    );
  }

  if (has('pubspec.yaml') && !has('pubspec.lock')) {
    out.push(
      finding({
        category: 'deps',
        severity: 'LOW',
        title: 'pubspec.yaml present but no pubspec.lock',
        detail: 'Applications should commit pubspec.lock to pin package versions.',
        files: ['pubspec.yaml'],
        lang: 'dart',
      })
    );
  }

  return out;
}

function sql(ctx) {
  const out = [];
  const files = ctx.sourceFiles.filter((f) => f.lang === 'sql');
  if (files.length === 0) return out;

  // SELECT * in migrations/production code is fragile.
  const starFiles = files.filter((f) => /\bSELECT\s+\*/i.test(readText(f.abs)));
  if (starFiles.length > 0) {
    out.push(
      finding({
        category: 'structure',
        severity: 'LOW',
        title: `SELECT * in ${starFiles.length} SQL file(s)`,
        detail: 'Column-list-independent queries break silently when the schema changes. Enumerate columns.',
        files: starFiles.slice(0, 8).map((f) => f.rel),
        count: starFiles.length,
        lang: 'sql',
      })
    );
  }
  return out;
}

export function analyze(ctx) {
  return [...scaffolding(ctx), ...manifests(ctx), ...sql(ctx)];
}
