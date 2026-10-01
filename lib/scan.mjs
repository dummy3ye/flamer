/**
 * File scanner that makes a single pass.
 *
 * The tree is walked exactly once. Each text file is read exactly once, and
 * every metric taken from the content (line count, long lines, CRLF, markers,
 * secrets, merge conflicts) is extracted from that single read. File contents
 * are never retained, so memory stays flat no matter how large the repo is.
 */
import { readText, looksBinary, readHead, isGeneratedName, LOCKFILES } from './util/fs.mjs';
import { matchLang } from './registry.mjs';

/** Files larger than this are not read at all (metadata only). */
const MAX_CONTENT_BYTES = 2 * 1024 * 1024;

/** Secrets scanning cost cap: large files are sampled, not fully scanned. */
const MAX_SCAN_BYTES = 512 * 1024;

const MARKER_KEYWORDS = ['TODO', 'FIXME', 'HACK', 'XXX', 'BUG', 'OPTIMIZE', 'REVIEW'];

const MARKER_RE = /\b(TODO|FIXME|HACK|XXX|BUG|OPTIMIZE|REVIEW)\b/g;

/**
 * Reliable secret patterns. Each entry redacts its own match so a
 * real credential is never echoed into the report.
 */

/**
 * Names that make an assignment look like a credential. Kept as a list so the
 * pattern stays readable and adding a name is a single line change.
 */
const SECRET_ASSIGNMENT_NAMES = [
  'api[_-]?key',
  'apikey',
  'secret',
  'passwd',
  'password',
  'token',
  'access[_-]?key',
  'private[_-]?key',
  'client[_-]?secret',
  'auth[_-]?token',
];

/** Matches `name = "value"` where the value looks like a real credential. */
const SECRET_ASSIGNMENT_RE = new RegExp(
  '\\b(?:' + SECRET_ASSIGNMENT_NAMES.join('|') + ')\\b\\s*[:=]\\s*["\'`]([^"\'`\\s]{12,})["\'`]',
  'gi'
);

/**
 * Cheap literal gates, one per pattern.
 *
 * Every pattern here is an anchored alternation, and running all fourteen over
 * every file in a large repository costs more than reading the files does. A
 * plain substring test is a native memchr and skips the regex engine entirely
 * for the 99% of files that cannot contain a credential of that shape.
 *
 * A pattern with no prefilter is always run. Failing open matters more than
 * failing fast here, because a missing gate silently loses a rule. The
 * assignment pattern is deliberately left ungated: its names are matched case
 * insensitively, so a literal gate would have to enumerate casings to be safe
 * and a missed casing is a silently dropped rule.
 */
export const SECRET_PATTERNS = [
  { kind: 'AWS access key id', re: /\b(A3T[A-Z0-9]|AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ABIA|ACCA)[A-Z0-9]{16}\b/g, group: 0, prefilter: ['A3T', 'AKIA', 'ASIA', 'AGPA', 'AIDA', 'AROA', 'AIPA', 'ANPA', 'ANVA', 'ABIA', 'ACCA'] },
  { kind: 'private key block', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g, group: 0, prefilter: ['-----BEGIN'] },
  { kind: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g, group: 0, prefilter: ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_'] },
  { kind: 'Slack token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, group: 0, prefilter: ['xox'] },
  { kind: 'Stripe key', re: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{20,}\b/g, group: 0, prefilter: ['_live_', '_test_'] },
  { kind: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g, group: 0, prefilter: ['AIza'] },
  { kind: 'OpenAI-style key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g, group: 0, prefilter: ['sk-'] },
  { kind: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{32,}\b/g, group: 0, prefilter: ['sk-ant-'] },
  { kind: 'npm token', re: /\bnpm_[A-Za-z0-9]{36}\b/g, group: 0, prefilter: ['npm_'] },
  { kind: 'PyPI token', re: /\bpypi-[A-Za-z0-9_-]{16,}\b/g, group: 0, prefilter: ['pypi-'] },
  { kind: 'JSON Web Token', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, group: 0, prefilter: ['eyJ'] },
  { kind: 'connection string with password', re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|mssql):\/\/[^\s:@/]+:[^\s:@/]{3,}@/g, group: 0, prefilter: ['://'] },
  { kind: 'hardcoded secret assignment', re: SECRET_ASSIGNMENT_RE, group: 1 },
  { kind: 'bearer token', re: /\bBearer\s+[A-Za-z0-9._~+/-]{24,}={0,2}\b/g, group: 0, prefilter: ['Bearer'] },
];

/** Common placeholder values that are definitely not real secrets. */
const PLACEHOLDERS = new Set([
  'your_api_key', 'yourapikey', 'api_key_here', 'changeme', 'change_me', 'replace_me',
  'xxxxxxxxxxxx', 'your-token-here', 'placeholder', 'example', 'dummy', 'todo',
  'insert_key_here', 'your-secret-here', 'none', 'null', 'test', 'fake',
  'your_password', 'password_here', 'not_a_real_key',
]);

/** Paths where a credential match is expected and not a leak. */
const SECRET_EXEMPT_PATHS = [
  /(^|\/)(test|tests|spec|specs|__tests__|__mocks__|fixtures?|mocks?|examples?|samples?|e2e|testdata|golden)(\/|$)/i,
  // A test file that sits alongside the source: foo.test.ts, foo.spec.js,
  // foo_test.go, test_foo.py. These are not under a tests/ directory, so the
  // rule above misses them. A secret scanner is exactly the kind of tool whose
  // fixtures hold fake credentials, and reporting those trains people to
  // ignore the real findings.
  /\.(test|spec)\.[a-z0-9]+$/i,
  /(^|\/)(test_[^/]+|[^/]+_test)\.[a-z0-9]+$/i,
  /\.(example|sample|template|dist)$/i,
  /(^|\/)(seed|seeds|dev-?seed)\w*\.[a-z0-9]+$/i,
  /\.lock$/i,
  /(^|\/)(CHANGELOG|HISTORY|NEWS|README|CONTRIBUTING)(\.|$)/i,
];

const CONFLICT_RE = /^(<{7}|={7}|>{7})(?: |$)/;

const SHEBANG_RE = /^#!\s*\/[^\n]*/;

/** True when a path is exempt from secret reporting. */
function isSecretExempt(rel) {
  return SECRET_EXEMPT_PATHS.some((re) => re.test(rel));
}

/**
 * Extract markers from comment text only, using a lightweight
 * string/comment state machine, so a keyword that merely appears inside a
 * string literal is not reported as an annotation.
 *
 * @param {string} text
 * @param {{line: string, block: string[][]}} spec
 * @returns {{type: string, line: number, text: string}[]}
 */
export function extractMarkers(text, spec) {
  const out = [];
  if (!spec || !spec.line) return out;
  const linePrefix = spec.line;
  const n = text.length;
  let i = 0;
  let lineNo = 1;
  let inLine = false;
  let inBlock = -1; // index into spec.block while inside a block comment
  let inString = null; // active quote char
  let blockStartLine = 0;
  let commentText = '';

  /** Record every marker found in `body`, offset to `baseLine`. */
  const emit = (body, baseLine) => {
    MARKER_RE.lastIndex = 0;
    let m;
    while ((m = MARKER_RE.exec(body)) !== null) {
      // line number = baseLine + newlines preceding the match
      let line = baseLine;
      for (let k = 0; k < m.index; k++) if (body.charCodeAt(k) === 10) line++;
      out.push({ type: m[1], line, text: body.slice(m.index, m.index + 80).trim() });
    }
  };

  while (i < n) {
    const ch = text[i];

    if (ch === '\n') {
      // A line comment ends here. Block comments survive newlines, so their
      // accumulated text (and the line numbers inside it) must stay intact.
      if (inLine) {
        emit(commentText, lineNo);
        inLine = false;
        commentText = '';
      } else if (inBlock !== -1) {
        commentText += '\n';
      }
      lineNo++;
      i++;
      continue;
    }

    if (inLine) {
      commentText += ch;
      i++;
      continue;
    }

    if (inBlock !== -1) {
      const [open, close] = spec.block[inBlock];
      if (text.startsWith(close, i)) {
        emit(commentText, blockStartLine);
        commentText = '';
        inBlock = -1;
        i += close.length;
        continue;
      }
      commentText += ch;
      i++;
      continue;
    }

    if (inString) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      i++;
      continue;
    }
    if (text.startsWith(linePrefix, i)) {
      inLine = true;
      commentText = linePrefix;
      i += linePrefix.length;
      continue;
    }
    if (ch !== ' ' && ch !== '\t') {
      const idx = (spec.block || []).findIndex((b) => text.startsWith(b[0], i));
      if (idx !== -1) {
        const open = spec.block[idx][0];
        inBlock = idx;
        blockStartLine = lineNo;
        commentText = open;
        i += open.length;
        continue;
      }
    }
    i++;
  }

  if (inLine) emit(commentText, lineNo);
  else if (inBlock !== -1) emit(commentText, blockStartLine);
  return out;
}

/** Redact a secret so it can be quoted safely in a report. */
function redact(match) {
  if (match.length <= 8) return '*'.repeat(match.length);
  return `${match.slice(0, 4)}${'*'.repeat(Math.min(match.length - 8, 12))}${match.slice(-4)}`;
}

/**
 * Offsets of every line start in a text, built once.
 *
 * indexOf walks newlines in native code. A per character charCodeAt loop over a
 * 500 MB corpus measured 3.7x slower, and split() measured slower still while
 * allocating an array of every line.
 * @returns {number[]}
 */
export function lineStarts(text) {
  const starts = [0];
  let nl = text.indexOf('\n');
  while (nl !== -1) {
    starts.push(nl + 1);
    nl = text.indexOf('\n', nl + 1);
  }
  return starts;
}

/** 1-based line number for a character offset, by binary search. */
function lineOf(starts, index) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/**
 * Scan a file's text for secrets.
 * @param {string} text
 * @param {number[]} [starts] line offsets, to avoid rebuilding them. Built
 *   lazily when omitted, because the overwhelming majority of files contain no
 *   credential at all and never need the index.
 * @returns {{kind: string, line: number, preview: string}[]}
 */
export function extractSecrets(text, starts) {
  const out = [];
  let lineIndex = starts || null;
  for (const { kind, re, group, prefilter } of SECRET_PATTERNS) {
    if (prefilter && !prefilter.some((needle) => text.includes(needle))) continue;
    re.lastIndex = 0;
    let m;
    let guard = 0;
    while ((m = re.exec(text)) !== null && guard++ < 20) {
      const value = m[group];
      if (!value) continue;
      if (PLACEHOLDERS.has(value.toLowerCase())) continue;
      if (lineIndex === null) lineIndex = lineStarts(text);
      out.push({ kind, line: lineOf(lineIndex, m.index), preview: redact(value) });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  return out;
}

/**
 * Scan one file record in place, adding the metrics taken from its content.
 * Returns the same record.
 */
export function scanFile(rec) {
  const match = matchLang(rec.rel);
  const lang = match.lang;
  rec.lang = lang ? lang.id : null;
  rec.langLabel = lang ? lang.label : null;
  rec.commentSpec = lang ? lang.comment : null;
  // 'ext' = real source, 'filename' = manifest/config recognized by name.
  rec.langVia = match.via;

  rec.isGenerated = isGeneratedName(rec.name);
  rec.isLockfile = LOCKFILES.has(rec.name);
  rec.isTest = lang ? lang.tests.some((re) => re.test(rec.rel)) : /(^|\/)(test|tests|spec|specs|__tests__)(\/|$)/i.test(rec.rel);

  rec.isBinary = false;
  rec.lines = 0;
  rec.maxLine = 0;
  rec.longLines = 0;
  rec.crlf = false;
  rec.noTrailingNewline = false;
  rec.hasShebang = false;
  rec.markers = [];
  rec.secrets = [];
  rec.conflictLines = [];

  if (rec.size === 0) {
    rec.empty = true;
    return rec;
  }
  rec.empty = false;

  if (rec.size > MAX_CONTENT_BYTES) {
    rec.skippedContent = true;
    return rec;
  }

  const head = readHead(rec.abs, 4096);
  if (looksBinary(head)) {
    rec.isBinary = true;
    return rec;
  }

  const text = readText(rec.abs);
  if (!text) {
    rec.unreadable = true;
    return rec;
  }

  rec.hasShebang = SHEBANG_RE.test(head);

  let lines = 0;
  let maxLine = 0;
  let longLines = 0;
  let start = 0;
  let nl = text.indexOf('\n');
  while (nl !== -1) {
    lines++;
    const len = nl - start;
    if (len > maxLine) maxLine = len;
    if (len > 200) longLines++;
    start = nl + 1;
    nl = text.indexOf('\n', start);
  }
  if (start < text.length) {
    lines++;
    const len = text.length - start;
    if (len > maxLine) maxLine = len;
    if (len > 200) longLines++;
  }
  rec.lines = lines;
  rec.maxLine = maxLine;
  rec.longLines = longLines;
  rec.crlf = text.includes('\r\n');
  rec.noTrailingNewline = text.length > 0 && !text.endsWith('\n');

  if (text.includes('<<<<<<<') || text.includes('=======') || text.includes('>>>>>>>')) {
    const linesArr = text.split('\n');
    for (let i = 0; i < linesArr.length; i++) {
      if (CONFLICT_RE.test(linesArr[i])) rec.conflictLines.push(i + 1);
    }
  }

  // Markers: only pay the cost of the state machine when a keyword is present.
  const hasMarkerKeyword = MARKER_KEYWORDS.some((k) => text.includes(k));
  if (hasMarkerKeyword && rec.commentSpec) {
    rec.markers = extractMarkers(text, rec.commentSpec).slice(0, 20);
  }

  if (!isSecretExempt(rec.rel)) {
    const slice = text.length > MAX_SCAN_BYTES ? text.slice(0, MAX_SCAN_BYTES) : text;
    rec.secrets = extractSecrets(slice).slice(0, 10);
  }

  return rec;
}

/**
 * True when the record counts as "source code" for statistics.
 *
 * Excludes: files with no recognized language, binaries, generated/minified
 * artifacts, lockfiles, and manifests matched by filename rather than
 * extension (requirements.txt is not Python source, Makefile is not C).
 */
export function isSource(rec) {
  if (!rec.lang) return false;
  if (rec.langVia !== 'ext') return false;
  if (rec.isBinary || rec.isGenerated || rec.isLockfile) return false;
  return true;
}

/**
 * True when the record is a text file whose line structure is meaningful.
 *
 * Notebooks are JSON documents, so checks that work by lines (overlong lines,
 * trailing newline, stub detection) produce noise instead of signal on them.
 * They are handled structurally by the notebook analyzer instead.
 */
export function isLineStructured(rec) {
  return isSource(rec) && rec.lang !== 'notebook';
}
