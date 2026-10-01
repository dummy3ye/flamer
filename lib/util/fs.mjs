/**
 * Filesystem helpers: safe stat/read, ignore rules, and the single pass
 * tree walker that every downstream analyzer consumes.
 */
import { readdirSync, readFileSync, statSync, lstatSync, existsSync as fsExists, openSync, readSync, closeSync } from 'fs';
import { join, relative, extname, basename, sep } from 'path';

/**
 * Directories never worth walking. Matched by name at any depth.
 *
 * Deliberately NOT ignored: `lib`, `esm`, `cjs`, `src`. Those are build output
 * for some ecosystems but plain source trees for many others, and guessing
 * wrong hides real code. Use `--ignore-dir <name>` to skip them explicitly.
 */
export const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules', 'bower_components', 'jspm_packages', '.pnpm-store', '.yarn',
  '.next', '.nuxt', '.svelte-kit', '.astro', '.docusaurus', '.vercel', '.netlify',
  '.turbo', '.parcel-cache', '.angular', '.vite', 'storybook-static',
  'dist', 'build', 'out', '.output',
  '.git', '.hg', '.svn', '.bzr', 'CVS', '.idea', '.vs', '.vscode-test',
  'coverage', '.nyc_output', 'htmlcov', '.tox', '.nox', '.pytest_cache', '.mypy_cache',
  '.ruff_cache', '.hypothesis', '.gradle', '.m2', '.dart_tool', '.pub-cache',
  '__pycache__', '.venv', 'venv', 'env', 'virtualenv', '.eggs', '*.egg-info',
  'site-packages', '.Python', 'pip-wheel-metadata',
  'target', 'vendor', 'Pods', 'DerivedData', 'bin', 'obj', '.stack-work', 'cabal',
  '_build', 'zig-cache', 'zig-out', '.ccls-cache', '.clangd',
  '.terraform', '.terragrunt-cache', '.serverless', '.pulumi', 'cdk.out',
  'tmp', 'temp', '.tmp', '.cache', '.sass-cache', '.ipynb_checkpoints', '.history',
  '.yarn-backups', '.eslintcache', '.DS_Store', '__snapshots__',
]);

/**
 * Hidden dirs that are worth descending into, such as the CI config in .github.
 * Everything else that starts with a dot is skipped.
 */
export const ALLOW_HIDDEN_DIRS = new Set([
  '.github', '.gitlab', '.circleci', '.config', '.husky', '.changeset',
  '.devcontainer', '.claude', '.cursor', '.github-workflows', '.cargo', '.clion',
]);

/** Lockfiles we recognize; never treat as "source" and never diff for bloat. */
export const LOCKFILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock',
  'npm-shrinkwrap.json', 'deno.lock', 'composer.lock', 'Gemfile.lock',
  'poetry.lock', 'Pipfile.lock', 'uv.lock', 'pdm.lock', 'Cargo.lock',
  'go.sum', 'Gopkg.lock', 'mix.lock', 'flake.lock', 'gradle.lockfile',
  'paket.lock', 'packages.lock.json', 'pubspec.lock', 'Podfile.lock',
  'Package.resolved', 'packages.config', 'cabal.project.freeze', 'conan.lock',
  '.terraform.lock.hcl', 'bun.lockb',
]);

/** Files that are always noise for bloat/test analysis. */
export const GENERATED_SUFFIXES = [
  '.min.js', '.min.css', '.bundle.js', '.chunk.js', '.map', '.lock', '.pb.go',
  '_pb2.py', '_pb2_grpc.py', '.designer.cs', '.g.cs', '.g.dart', '.freezed.dart',
  '_generated.go', '.generated.ts', '.gen.go', '.d.ts',
];

/** Read a UTF-8 file, returning '' on any failure. Never throws. */
export function readText(file) {
  try {
    return readFileSync(file, 'utf-8');
  } catch {
    return '';
  }
}

/** Parse JSON, returning null on any failure. */
export function readJSON(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

export function exists(p) {
  try {
    return fsExists(p);
  } catch {
    return false;
  }
}

/** Alias so analyzers can import a familiar name. */
export const existsSync = exists;

export function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Heuristic binary detection. Reads only the first 4KB: a NUL byte, or a high
 * ratio of unprintable characters.
 */
export function looksBinary(buf) {
  const len = Math.min(buf.length, 4096);
  if (len === 0) return false;

  // A NUL byte is the classic binary marker.
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }

  // Control characters (tab, LF, CR and FF excepted) are the real binary
  // signal. This check is immune to the multibyte problem below, because
  // every UTF-8 continuation byte is >= 0x80 and can never land in this range.
  let control = 0;
  for (let i = 0; i < len; i++) {
    const b = buf[i];
    if (b < 32 && b !== 9 && b !== 10 && b !== 13 && b !== 12) control++;
  }
  if (control / len > 0.1) return true;

  // Bytes >= 0x80 are ambiguous: suspicious in ASCII, but perfectly normal
  // multibyte UTF-8. So only weight them if the sample is not valid UTF-8.
  const decoded = utf8Decoder.decode(buf.subarray(0, len));
  // Replacement characters at the very end are an artifact of truncating a
  // multibyte character at the sample boundary, not evidence of binary data.
  if (!decoded.slice(0, -4).includes('\uFFFD')) return false;

  // Invalid UTF-8 with a heavy tail of high bytes: a legacy binary format.
  let high = 0;
  for (let i = 0; i < len; i++) {
    if (buf[i] > 126) high++;
  }
  return high / len > 0.3;
}

const utf8Decoder = new TextDecoder('utf-8', { fatal: false });

/** Read only the first N bytes of a file as a Buffer, '' on failure. */
export function readHead(file, bytes = 4096) {
  let fd;
  try {
    fd = openSync(file, 'r');
    const buf = Buffer.alloc(bytes);
    const read = readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, read);
  } catch {
    return Buffer.alloc(0);
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

export function safeStat(p) {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
}

/** Path relative to root, always with forward slashes. */
export function rel(root, abs) {
  return relative(root, abs).split(sep).join('/');
}

/** True when the basename matches a generated/minified artifact. */
export function isGeneratedName(name) {
  const lower = name.toLowerCase();
  if (GENERATED_SUFFIXES.some((s) => lower.endsWith(s))) return true;
  if (/\.min\.(js|css)$/.test(lower)) return true;
  if (/(^|[._-])(generated|gen|autogen|auto_gen|__generated__)([._-]|$)/.test(lower)) return true;
  return false;
}

/**
 * Single pass tree walk. Calls `onFile(record)` for every candidate file and
 * `onDir(absPath, name, relPath)` for every not ignored directory.
 *
 * Yields records: { abs, path, rel, name, ext, size, depth }
 * Directories are pruned by DEFAULT_IGNORE_DIRS (plus `extraIgnores`) and by
 * any dir starting with '.' except ALLOW_HIDDEN_DIRS.
 *
 * @returns {{ files: any[], truncated: boolean, dirs: string[], skippedBytes: number }}
 */
export function walkTree(root, opts = {}) {
  const {
    extraIgnores = new Set(),
    followSymlinks = false,
    onFile = () => {},
    onDir = () => {},
  } = opts;

  const ignoreDirs = new Set([...DEFAULT_IGNORE_DIRS, ...extraIgnores]);
  const files = [];
  const dirs = [];
  let skippedBytes = 0;

  const stack = [{ abs: root, rel: '', depth: 0 }];

  while (stack.length) {
    const { abs: dirAbs, rel: dirRel, depth } = stack.pop();
    let entries;
    try {
      entries = readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const name = entry.name;
      const abs = join(dirAbs, name);
      const r = rel(root, abs);
      const isHidden = name.startsWith('.');

      let isDirectory = entry.isDirectory();
      let isSymlink = entry.isSymbolicLink();

      if (isSymlink) {
        if (!followSymlinks) continue;
        const st = safeStat(abs);
        if (!st) continue;
        isDirectory = st.isDirectory();
        isSymlink = false;
      }

      if (isDirectory) {
        if (ignoreDirs.has(name)) continue;
        if (isHidden && !ALLOW_HIDDEN_DIRS.has(name)) continue;
        dirs.push(r);
        onDir(abs, name, r);
        stack.push({ abs, rel: r, depth: depth + 1 });
        continue;
      }

      if (!entry.isFile() && !isSymlink) continue;

      // Dotfiles at the root are always surfaced (for example .env or .DS_Store) so
      // downstream analyzers can flag them even though we skip hidden dirs.
      if (isHidden && depth > 0 && !ALLOW_HIDDEN_DIRS.has(dirRel.split('/')[0])) {
        const st = safeStat(abs);
        if (st) {
          onFile({ abs, path: abs, rel: r, name, ext: extname(name), size: st.size, depth, hidden: true });
          files.push({ abs, rel: r, name, ext: extname(name), size: st.size, depth, hidden: true });
        }
        continue;
      }

      const st = safeStat(abs);
      if (!st || !st.isFile()) continue;
      skippedBytes += st.size;
      const rec = { abs, rel: r, name, ext: extname(name), size: st.size, depth, hidden: isHidden };
      onFile(rec);
      files.push(rec);
    }
  }

  return { files, dirs, truncated: false, skippedBytes };
}

/** Immediate subdirectory names of a directory. */
export function subdirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith('.'))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** Immediate file names of a directory. */
export function filesIn(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
  } catch {
    return [];
  }
}
