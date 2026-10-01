import { join } from 'path';
import { finding } from '../util/findings.mjs';
import { readText, filesIn, isDir } from '../util/fs.mjs';

const PY_MANIFESTS = ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'Pipfile', 'environment.yml'];

export function analyze(ctx) {
  const out = [];
  if (!ctx.profile.tooling.isPython && !ctx.sourceFiles.some((f) => f.lang === 'python')) return out;

  const foundManifests = [];
  for (const name of PY_MANIFESTS) {
    if (filesIn(ctx.root).includes(name)) foundManifests.push(name);
  }
  if (foundManifests.length === 0 && ctx.sourceFiles.some((f) => f.lang === 'python')) {
    out.push(
      finding({
        category: 'config',
        severity: 'MEDIUM',
        title: 'Python code with no dependency manifest',
        detail: `None of ${PY_MANIFESTS.join(', ')} present. Dependencies are undeclared and not reproducible.`,
      })
    );
  }

  for (const req of ['requirements.txt', 'requirements-dev.txt']) {
    const rec = ctx.files.find((f) => f.rel === req);
    if (!rec) continue;
    const text = readText(rec.abs);
    if (!text) continue;
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('-'));
    const unpinned = lines.filter((l) => !/[=><~!]|\bgit\+|@|file:/.test(l));
    if (unpinned.length > 0) {
      out.push(
        finding({
          category: 'deps',
          severity: 'MEDIUM',
          title: `${unpinned.length} unpinned requirement(s) in ${req}`,
          detail: unpinned.slice(0, 12).join(', ') + '. Unpinned requirements make installs non-reproducible.',
          files: [req],
          count: unpinned.length,
        })
      );
    }
  }

  const venvDirs = ['.venv', 'venv', 'env', 'virtualenv'];
  const trackedVenv = [];
  for (const d of venvDirs) {
    if (ctx.gitTracked && ctx.gitTracked.size > 0) {
      for (const p of ctx.gitTracked) {
        if (p.startsWith(`${d}/`) || p.includes(`/${d}/`)) trackedVenv.push(p);
      }
    } else if (isDir(join(ctx.root, d))) {
      trackedVenv.push(d);
    }
  }
  if (trackedVenv.length > 0) {
    out.push(
      finding({
        category: 'vcs',
        severity: 'HIGH',
        title: 'Python virtualenv committed to the repository',
        detail: `Virtualenv directories (${venvDirs.join(', ')}) contain thousands of absolute-path-bound files. Files: ${[...new Set(trackedVenv)].slice(0, 5).join(', ')}.`,
        files: [...new Set(trackedVenv)].slice(0, 5),
        count: new Set(trackedVenv).size,
      })
    );
  }

  const pycache = ctx.sourceFiles.filter((f) => /__pycache__|\.pyc$/.test(f.rel));
  if (pycache.length > 0) {
    out.push(
      finding({
        category: 'vcs',
        severity: 'LOW',
        title: `${pycache.length} Python bytecode file(s) present in the tree`,
        detail: '__pycache__/*.pyc should be gitignored. They are machine-specific build artifacts.',
        files: pycache.slice(0, 5).map((f) => f.rel),
        count: pycache.length,
      })
    );
  }

  const pyFiles = ctx.sourceFiles.filter((f) => f.lang === 'python');
  if (pyFiles.length > 5) {
    const hasMypy = filesIn(ctx.root).some((f) => ['mypy.ini', '.mypy.ini', 'setup.cfg', 'pyproject.toml'].includes(f));
    const hasPyrightCfg = filesIn(ctx.root).includes('pyrightconfig.json');
    if (!hasMypy && !hasPyrightCfg) {
      out.push(
        finding({
          category: 'config',
          severity: 'LOW',
          title: 'No Python type checker configured',
          detail: `${pyFiles.length} Python source file(s) but no mypy/pyright configuration. Type errors go unnoticed.`,
        })
      );
    }
  }

  return out;
}
