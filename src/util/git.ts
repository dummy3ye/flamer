/**
 * Thin, safe wrapper around the `git` CLI.
 *
 * Every call tolerates failure. If git is missing or the directory is not a
 * repository, callers get null/empty and analyzers degrade to a single
 * "no git history" finding instead of crashing.
 */
import { execFileSync } from 'child_process';

let cachedAvailability = null;

/** @returns {string|null} the git dir path, or null if unavailable. */
export function gitDir(cwd) {
  if (cachedAvailability === false) return null;
  try {
    const out = execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    }).trim();
    if (out) cachedAvailability = true;
    return out || null;
  } catch {
    cachedAvailability = false;
    return null;
  }
}

export function isRepo(cwd) {
  return gitDir(cwd) !== null;
}

function run(args, cwd, { timeout = 20_000 } = {}) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/** Set of paths tracked by git, relative to the repo root. Empty on failure. */
export function trackedFiles(cwd) {
  const out = run(['ls-files', '-z'], cwd);
  if (out === null) return new Set();
  return new Set(out.split('\0').filter(Boolean));
}

/**
 * Commits as { hash, author, email, date, subject }.
 * @param {string} cwd
 * @param {{ limit?: number, all?: boolean }} opts
 */
export function commits(cwd, { limit = 0, all = true } = {}) {
  const sep = '\x1f';
  const rec = '\x1e';
  const args = ['log', `--format=%h${sep}%an${sep}%ae${sep}%aI${sep}%s${rec}`];
  if (all) args.push('--all');
  if (limit > 0) args.push(`-n${limit}`);
  const out = run(args, cwd, { timeout: 60_000 });
  if (out === null) return null;
  return out
    .split(rec)
    .map((chunk) => chunk.replace(/^\n+/, ''))
    .filter(Boolean)
    .map((chunk) => {
      const [hash, author, email, date, ...rest] = chunk.split(sep);
      return {
        hash: (hash || '').trim(),
        author: (author || '').trim(),
        email: (email || '').trim(),
        date: (date || '').trim(),
        subject: rest.join(sep).trim(),
      };
    })
    .filter((c) => c.hash);
}

/**
 * Largest blobs currently in the tree.
 * @returns {{ path: string, kb: number }[]}
 */
export function largestTrackedFiles(cwd, limit = 10) {
  const out = run(['ls-tree', '-r', '-l', 'HEAD'], cwd, { timeout: 30_000 });
  if (out === null) return [];
  return out
    .split('\n')
    .map((line) => {
      // mode SP type SP hash SP size TAB path
      const tabIdx = line.indexOf('\t');
      if (tabIdx === -1) return null;
      const meta = line.slice(0, tabIdx).split(/\s+/);
      const path = line.slice(tabIdx + 1);
      const size = Number.parseInt(meta[3], 10);
      if (!Number.isFinite(size) || size < 200 * 1024) return null;
      return { path, kb: Math.round(size / 1024) };
    })
    .filter(Boolean)
    .sort((a, b) => b.kb - a.kb)
    .slice(0, limit);
}
