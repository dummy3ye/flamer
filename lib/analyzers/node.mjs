/**
 * JavaScript / TypeScript / Node ecosystem checks.
 *
 * Covers the checks the original monorepos only flamer performed (dependency version
 * drift across packages, missing scripts, tsconfig) and extends them.
 */
import { join } from 'path';
import { finding } from '../util/findings.mjs';
import { readJSON, existsSync, filesIn } from '../util/fs.mjs';

/** Node script names worth flagging when missing. */
const SCRIPT_CHECKS = [
  { name: 'test', severity: 'HIGH', alt: ['test:run', 'tests', 'test:unit'] },
  { name: 'build', severity: 'HIGH', alt: ['build:prod', 'compile'] },
  { name: 'lint', severity: 'MEDIUM', alt: ['lint:js', 'eslint'] },
  { name: 'typecheck', severity: 'MEDIUM', alt: ['type-check', 'typecheck:ci', 'tsc'] },
];

/** Package.json fields that should exist for a published/consumable package. */
const FIELDS = [
  { key: 'name', severity: 'HIGH', msg: 'missing "name"' },
  { key: 'version', severity: 'MEDIUM', msg: 'missing "version"' },
  { key: 'license', severity: 'MEDIUM', msg: 'missing "license"' },
  { key: 'description', severity: 'LOW', msg: 'missing "description"' },
  { key: 'repository', severity: 'LOW', msg: 'missing "repository"' },
];

const DEP_TYPES = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

/** Compare two loose semver ranges for exact equality only (no semver dep). */
function rangesDiffer(a, b) {
  return String(a).trim() !== String(b).trim();
}

function collectManifests(ctx) {
  const manifests = [];
  for (const scope of ctx.profile.scopes) {
    const pkgPath = scope.isRoot ? join(ctx.root, 'package.json') : join(ctx.root, scope.path, 'package.json');
    if (!existsSync(pkgPath)) continue;
    const pkg = readJSON(pkgPath);
    if (!pkg) {
      manifests.push({ scope, pkg: null, relPath: scope.isRoot ? 'package.json' : `${scope.path}/package.json`, invalid: true });
      continue;
    }
    manifests.push({
      scope,
      pkg,
      relPath: scope.isRoot ? 'package.json' : `${scope.path}/package.json`,
      invalid: false,
    });
  }
  return manifests;
}

export function analyze(ctx) {
  const out = [];
  const manifests = collectManifests(ctx);
  if (manifests.length === 0) return out;

  for (const m of manifests.filter((x) => x.invalid)) {
    out.push(
      finding({
        category: 'config',
        severity: 'HIGH',
        title: `Invalid JSON in ${m.relPath}`,
        detail: 'The manifest could not be parsed. This will break installs and most tooling.',
        files: [m.relPath],
      })
    );
  }
  const valid = manifests.filter((m) => !m.invalid);

  const depIndex = new Map(); // dep -> Map<pkgName, range>
  for (const m of valid) {
    for (const type of DEP_TYPES) {
      const deps = m.pkg[type];
      if (!deps || typeof deps !== 'object') continue;
      for (const [name, range] of Object.entries(deps)) {
        if (!depIndex.has(name)) depIndex.set(name, new Map());
        depIndex.get(name).set(m.scope.name || 'root', { range, type });
      }
    }
  }
  for (const [dep, byPkg] of depIndex) {
    if (byPkg.size < 2) continue;
    const ranges = [...byPkg.values()].map((v) => String(v.range));
    const unique = [...new Set(ranges)];
    if (unique.length > 1) {
      out.push(
        finding({
          category: 'deps',
          severity: 'CRITICAL',
          title: `Dependency "${dep}" has ${unique.length} different version ranges across packages`,
          detail: [...byPkg.entries()].map(([pkg, v]) => `${pkg}: ${v.range} (${v.type})`).join(', ') + '. Pin one version and use workspace protocol / overrides.',
          count: byPkg.size,
        })
      );
    }
  }

  for (const m of valid) {
    const name = m.scope.name || 'root';
    const scripts = m.pkg.scripts || {};

    for (const check of SCRIPT_CHECKS) {
      const present = scripts[check.name] || (check.alt || []).some((a) => scripts[a]);
      // Only require build/test for packages that actually contain source.
      const hasSource = m.scope.isRoot
        ? ctx.sourceFiles.some((f) => ['javascript', 'typescript'].includes(f.lang))
        : ctx.sourceFiles.some((f) => f.rel.startsWith(`${m.scope.path}/`) && ['javascript', 'typescript'].includes(f.lang));
      if (!present && hasSource) {
        out.push(
          finding({
            category: 'script',
            severity: check.severity,
            title: `Package "${name}" has no "${check.name}" script`,
            detail: `No ${check.name} script in ${m.relPath}.${check.alt?.length ? ` (also checked: ${check.alt.join(', ')})` : ''}`,
            files: [m.relPath],
          })
        );
      }
    }

    for (const f of FIELDS) {
      if (m.pkg[f.key] === undefined) {
        out.push(
          finding({
            category: 'config',
            severity: f.severity,
            title: `Package "${name}" ${f.msg}`,
            detail: `${m.relPath} has no "${f.key}" field.`,
            files: [m.relPath],
          })
        );
      }
    }

    // Version pinning: caret/tilde on runtime deps is a reproducibility risk.
    const unpinned = Object.entries(m.pkg.dependencies || {}).filter(([, r]) => /^[~^*]|\|\||\bx\b|\*$/i.test(String(r)) && !/^(npm|file|link|workspace|git|http)/.test(String(r)));
    if (unpinned.length > 0) {
      out.push(
        finding({
          category: 'deps',
          severity: 'MEDIUM',
          title: `Package "${name}" has ${unpinned.length} loosely-pinned runtime dependenc(ies)`,
          detail: unpinned.map(([d, r]) => `${d}@${r}`).join(', '),
          files: [m.relPath],
          count: unpinned.length,
        })
      );
    }

    const wildcards = Object.entries(m.pkg.dependencies || {}).filter(([, r]) => String(r).trim() === '*' || String(r).trim() === '');
    if (wildcards.length > 0) {
      out.push(
        finding({
          category: 'deps',
          severity: 'HIGH',
          title: `Package "${name}" uses wildcard version(s) in dependencies`,
          detail: wildcards.map(([d]) => d).join(', ') + '. Wildcards make builds non-reproducible.',
          files: [m.relPath],
        })
      );
    }
  }

  const rootPkg = valid.find((m) => m.scope.isRoot);
  if (rootPkg) {
    const hasTsconfig = existsSync(join(ctx.root, 'tsconfig.json'));
    const declaresTs = Boolean(rootPkg.pkg.devDependencies?.typescript || rootPkg.pkg.dependencies?.typescript);
    const usesTsExt = ctx.sourceFiles.some((f) => f.lang === 'typescript');
    if (usesTsExt && !declaresTs) {
      out.push(
        finding({
          category: 'deps',
          severity: 'HIGH',
          title: 'TypeScript sources present but "typescript" is not a declared dependency',
          detail: 'No typescript in dependencies/devDependencies. Editor and CI type-checking will silently do nothing.',
          files: ['package.json'],
        })
      );
    }
    if (!hasTsconfig && usesTsExt) {
      out.push(
        finding({
          category: 'config',
          severity: 'HIGH',
          title: 'TypeScript sources but no tsconfig.json',
          detail: 'Without a tsconfig, there is no configured target, module resolution, or strictness.',
        })
      );
    }

    const lockPresent = filesIn(ctx.root).some((f) => ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock', 'npm-shrinkwrap.json'].includes(f));
    if (!lockPresent && !ctx.options.noLockfileWarning) {
      out.push(
        finding({
          category: 'deps',
          severity: 'MEDIUM',
          title: 'No JavaScript lockfile at the repository root',
          detail: 'No package-lock.json / yarn.lock / pnpm-lock.yaml / bun.lock. Dependency resolution is not reproducible.',
        })
      );
    }

    if (!rootPkg.pkg.engines?.node) {
      out.push(
        finding({
          category: 'config',
          severity: 'LOW',
          title: 'Root package.json has no "engines.node" constraint',
          detail: 'Node version is unpinned, so local and CI runtimes can drift silently.',
          files: ['package.json'],
        })
      );
    }
  }

  const tsconfigs = ctx.sourceFiles.filter((f) => f.name === 'tsconfig.json');
  for (const tsc of tsconfigs) {
    const raw = readJSON(join(ctx.root, tsc.rel));
    if (!raw) continue;
    const compiler = raw.compilerOptions || {};
    const strict = compiler.strict === true || (compiler.strictNullChecks === true && compiler.noImplicitAny === true);
    if (!strict) {
      out.push(
        finding({
          category: 'config',
          severity: 'MEDIUM',
          title: `${tsc.rel} does not enable TypeScript strict mode`,
          detail: 'Without "strict": true, null/undefined and implicit-any bugs pass the compiler silently.',
          files: [tsc.rel],
        })
      );
    }
  }

  return out;
}
