import { finding } from '../util/findings.mjs';
import * as git from '../util/git.mjs';

/**
 * Commit subjects that carry no information on their own.
 *
 * These are matched as whole trimmed strings, ignoring case, because a
 * message that is *only* "fix" says nothing at all. A short but specific
 * message like "fix parser overflow" is caught separately by the minimum
 * length check, so single letters are intentionally absent here. They would
 * be redundant with that rule.
 */
const GENERIC_MSG_SUBJECTS = new Set([
  'fix', 'fixed', 'fixes',
  'update', 'updates', 'updated',
  'change', 'changes', 'changed',
  'remove', 'removed',
  'test', 'tests',
  'refactor', 'cleanup', 'minor', 'tweak', 'adjust', 'patch', 'typo',
  'rename', 'move', 'edit',
  'add', 'added', 'new', 'old',
  'initial', 'first', 'start',
  'wip', 'todo', 'done', 'progress', 'working', 'checkpoint', 'save', 'commit',
  'wip2', 'final', 'final2',
  'stuff', 'things', 'misc', 'more', 'whatever', 'meh', 'idk', 'ok', 'nice',
  'foo', 'bar', 'baz', 'qux', 'asdf', 'oops', 'hmm',
  'tmp', 'temp', 'scratch',
  'hack', 'fixup', 'squash',
]);

/** Minimum subject length before we call a message uninformative. */
const MIN_MSG_LENGTH = 10;

/** True when a commit subject is too vague to be useful later. */
function isGenericMessage(subject) {
  const s = subject.trim().toLowerCase();
  return GENERIC_MSG_SUBJECTS.has(s) || s.length < MIN_MSG_LENGTH;
}

const fmt = (n) => n.toLocaleString('en-US');

export function analyze(ctx) {
  const out = [];
  const hasRepo = git.isRepo(ctx.root);

  // History analysis needs a repository. Without one, say so and stop, rather
  // than reporting a clean history that does not exist.
  if (!hasRepo) {
    out.push(
      finding({
        category: 'git',
        severity: 'LOW',
        title: 'No git repository detected',
        detail: 'Version control history is unavailable, so history-based findings were skipped.',
      })
    );
  }

  const log = hasRepo ? git.commits(ctx.root, { limit: ctx.options.commitLimit }) : null;
  const count = log === null ? null : log.length;

  if (log && log.length === 0) {
    out.push(
      finding({
        category: 'git',
        severity: 'LOW',
        title: 'Git repository has no commits',
        detail: 'The repo is initialized but empty.',
      })
    );
  }

  if (log && log.length > 0) {
    const authors = new Set(log.map((c) => c.author || c.email));
    const generic = log.filter((c) => isGenericMessage(c.subject));

    if (log.length < 10) {
      out.push(
        finding({
          category: 'git',
          severity: 'MEDIUM',
          title: `Sparse git history (${log.length} commit(s))`,
          detail: `Only ${log.length} commit(s) across ${authors.size} author(s). Most recent: ${log.slice(0, 3).map((c) => `"${c.subject}"`).join(', ')}.`,
          count: log.length,
        })
      );
    }

    const genericPct = Math.round((generic.length / log.length) * 100);
    if (generic.length > 0 && generic.length / log.length > 0.25) {
      out.push(
        finding({
          category: 'git',
          severity: 'MEDIUM',
          title: `${generic.length}/${log.length} (${genericPct}%) commit messages are generic or too short`,
          detail: `Examples: ${generic.slice(0, 5).map((c) => `"${c.subject}"`).join(', ')}. Uninformative messages make bisect and blame archaeology painful.`,
          count: generic.length,
        })
      );
    }

    if (authors.size === 1 && log.length > 3) {
      out.push(
        finding({
          category: 'git',
          severity: 'LOW',
          title: `Solo project (${log.length} commits, 1 author)`,
          detail: 'A single author across the whole history. Either a solo project or teammates are not committing.',
          count: log.length,
        })
      );
    }
  }

  const big = hasRepo ? git.largestTrackedFiles(ctx.root, 10) : [];
  if (big.length > 0) {
    out.push(
      finding({
        category: 'git',
        severity: 'LOW',
        title: `${big.length} large blob(s) tracked in git (>200KB)`,
        detail: `Largest: ${big.slice(0, 5).map((b) => `${b.path} (${fmt(b.kb)}KB)`).join(', ')}. Large binaries bloat clone time forever.`,
        files: big.slice(0, 6).map((b) => b.path),
        count: big.length,
      })
    );
  }

  return out;
}
