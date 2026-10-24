#!/usr/bin/env node

/**
 * flamer is a language neutral code health auditor.
 *
 * Walks a repository once, runs every registered analyzer, and prints a
 * terminal-friendly report or JSON. Findings are factual (see SKILL.md).
 */

import { writeFileSync, existsSync } from 'fs';
import { resolve, basename } from 'path';

import { walkTree, filesIn, isDir } from './util/fs.js';
import {
  finding,
  sortFindings,
  severityTally,
  worstSeverity,
  SEVERITIES,
  rank,
} from './util/findings.js';
import { detectScopes, buildProfile, projectKind } from './detect.js';
import { scanFile, isSource, isLineStructured } from './scan.js';
import { ANALYZERS } from './analyzers/index.js';
import * as git from './util/git.js';
import { LANGUAGES, allExtensions } from './registry.js';
import { runNativeMetrics } from './native.js';

const SPEC_VERSION = 1;

function parseArgs(argv: string[]) {
  const opts = {
    root: process.cwd(),
    format: 'summary',
    out: null as string | null,
    failOn: null as string | null,
    maxFiles: 60000,
    commitLimit: 1000,
    noGit: false,
    noLockfileWarning: false,
    quiet: false,
    scope: null as string | null,
    listLanguages: false,
    help: false,
    color: null as boolean | null,
    engine: 'all' as 'all' | 'typescript' | 'rust' | 'cpp',
    ignoreDirs: [] as string[],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--package':
      case '--scope':
        opts.scope = argv[++i];
        break;
      case '--ignore-dir':
        if (argv[i + 1]) opts.ignoreDirs.push(argv[++i]);
        break;
      case '--path':
        opts.root = resolve(argv[++i] || '.');
        break;
      case '--format':
        opts.format = (argv[++i] || 'json').toLowerCase();
        break;
      case '--out':
        opts.out = argv[++i];
        break;
      case '--fail-on':
        opts.failOn = (argv[++i] || '').toUpperCase();
        break;
      case '--max-files':
        opts.maxFiles = Number.parseInt(argv[++i] || '', 10) || opts.maxFiles;
        break;
      case '--commit-limit':
        opts.commitLimit = Number.parseInt(argv[++i] || '', 10) || opts.commitLimit;
        break;
      case '--no-git':
        opts.noGit = true;
        break;
      case '--no-lockfile-warning':
        opts.noLockfileWarning = true;
        break;
      case '--quiet':
        opts.quiet = true;
        break;
      case '--color':
        opts.color = true;
        break;
      case '--no-color':
        opts.color = false;
        break;
      case '--engine':
        opts.engine = (argv[++i] || 'all') as 'all' | 'typescript' | 'rust' | 'cpp';
        if (!['all', 'typescript', 'rust', 'cpp'].includes(opts.engine)) {
          process.stderr.write(`invalid engine: ${opts.engine}\n`);
          process.exit(2);
        }
        break;
      case '--list-languages':
        opts.listLanguages = true;
        break;
      case '-h':
      case '--help':
        opts.help = true;
        break;
      default:
        if (a.startsWith('-')) {
          process.stderr.write(`unknown option: ${a}\nRun with --help for the option list.\n`);
          process.exit(2);
        }
        if (a !== '.') opts.root = resolve(a);
        break;
    }
  }
  return opts;
}

function printHelp() {
  process.stdout.write(`flamer, language-agnostic code health auditor

Usage:
  flamer [path] [options]

Options:
  --package, --scope <name>  analyze only the named sub-project
  --path <dir>               repository root (default: cwd)
  --format <json|summary>    output format (default: summary)
  --out <file>               also write the JSON report to a file
  --fail-on <SEVERITY>       exit 1 if a finding is at/above this severity
                            (${SEVERITIES.join(' | ')})
  --max-files <n>            stop walking after n files (default ${60000})
  --commit-limit <n>         commits to inspect for git analysis (default 1000)
  --no-git                   skip git analysis entirely
  --no-lockfile-warning      skip the "no lockfile" suggestion
  --ignore-dir <name>        also skip this directory name (repeatable)
  --quiet                    suppress the human summary
  --color                    force ANSI colors
  --no-color                 disable ANSI colors
  --engine <all|typescript|rust|cpp>
                            all runs TypeScript, Rust, and C++ (default: all)
  --list-languages           print the supported language table
  -h, --help                 show this help
`);
}

function printLanguages() {
  process.stdout.write(`flamer understands ${LANGUAGES.length} language/ecosystem profiles:\n\n`);
  for (const l of LANGUAGES) {
    process.stdout.write(`  ${l.id.padEnd(12)} ${l.label.padEnd(22)} ${l.exts.join(' ')}\n`);
  }
  process.stdout.write(`\n${allExtensions().length} file extensions recognized.\n`);
}
function run(opts: any) {
  const started = Date.now();
  const root = opts.root;

  if (!existsSync(root) || !isDir(root)) {
    const err = {
      specVersion: SPEC_VERSION,
      tool: 'flamer',
      version: 2,
      project: { name: basename(root), kind: [], languages: [], root, scopes: [] },
      findings: [
        finding({
          category: 'error',
          severity: 'CRITICAL',
          title: `Path not found or not a directory: ${root}`,
          detail: 'Point flamer at an existing repository directory.',
        }),
      ],
      metadata: { generatedAt: new Date().toISOString(), durationSeconds: 0 },
    };
    return { report: err, exitCode: 2 };
  }

  const detected = detectScopes(root);

  const walkStart = Date.now();
  let truncated = false;
  const collected: any[] = [];
  walkTree(root, {
    extraIgnores: new Set(opts.ignoreDirs),
    onFile: (rec: any) => {
      if (collected.length >= opts.maxFiles) {
        truncated = true;
        return;
      }
      collected.push(scanFile(rec));
    },
  });
  const files = collected;
  const walkMs = Date.now() - walkStart;

  const profile = buildProfile(root, detected, files);

  let scopes = profile.scopes;
  let scopedFiles = files;
  if (opts.scope) {
    const match = scopes.find((s: any) => s.name === opts.scope);
    if (!match) {
      const available = scopes.map((s: any) => s.name || 'root').join(', ') || 'none';
      const rep = emptyReport(root, profile, started);
      rep.findings.push(
        finding({
          category: 'error',
          severity: 'LOW',
          title: `Scope "${opts.scope}" not found`,
          detail: `Available scopes: ${available}.`,
        }),
      );
      return { report: rep, exitCode: 0 };
    }
    scopes = [match];
    if (match.path) {
      const prefix = `${match.path}/`;
      scopedFiles = files.filter((f: any) => f.rel === match.path || f.rel.startsWith(prefix));
    }
  }

  const sourceFiles = scopedFiles.filter(isSource);
  const structuredFiles = scopedFiles.filter(isLineStructured);
  const rootFileNames = new Set(filesIn(root));
  const repoSourceFileCount = files.filter(isSource).length;

  let gitTracked = null;
  if (!opts.noGit) gitTracked = git.isRepo(root) ? git.trackedFiles(root) : new Set();

  const ctx = {
    root,
    options: opts,
    files: scopedFiles,
    sourceFiles,
    structuredFiles,
    repoSourceFileCount,
    rootFileNames,
    profile: { ...profile, scopes },
    scopes,
    gitTracked,
  };

  const findings: any[] = [];
  const analyzerResults: any[] = [];
  for (const a of ANALYZERS) {
    const t0 = Date.now();
    try {
      const res = a.fn(ctx) || [];
      findings.push(...res);
      analyzerResults.push({
        id: a.id,
        label: a.label,
        findings: res.length,
        ms: Date.now() - t0,
        error: null,
      });
    } catch (e: any) {
      const msg = e && e.message ? e.message : String(e);
      findings.push(
        finding({
          category: 'error',
          severity: 'LOW',
          title: `Analyzer "${a.id}" failed`,
          detail: msg,
        }),
      );
      analyzerResults.push({
        id: a.id,
        label: a.label,
        findings: 0,
        ms: Date.now() - t0,
        error: msg,
      });
    }
  }

  const sorted = sortFindings(findings);
  const report = {
    specVersion: SPEC_VERSION,
    tool: 'flamer',
    version: 2,
    project: {
      name: basename(root),
      root,
      kind: projectKind(profile),
      layout: profile.layout,
      languages: profile.languages,
      dominantLanguage: profile.dominantLanguage,
      packages: scopes.map((s: any) => s.name || 'root'),
      totalFiles: scopedFiles.length,
      totalSourceFiles: sourceFiles.length,
      totalLines: sourceFiles.reduce((s: number, f: any) => s + (f.lines || 0), 0),
      tooling: profile.tooling,
    },
    findings: sorted,
    metadata: {
      generatedAt: new Date().toISOString(),
      durationSeconds: (Date.now() - started) / 1000,
      walkMs,
      truncated,
      severities: severityTally(sorted),
      worst: worstSeverity(sorted),
      analyzers: analyzerResults,
    },
  };

  if (opts.engine !== 'typescript') {
    const workers = opts.engine === 'all' ? ['rust', 'cpp'] : [opts.engine];
    const nativeResults: Record<string, any> = {};
    try {
      for (const worker of workers) {
        const native = runNativeMetrics(
          root,
          scopedFiles.map((file: any) => file.rel),
          worker,
        );
        nativeResults[worker] = {
          files: native.metrics.files,
          bytes: native.metrics.bytes,
          lines: native.metrics.lines,
          durationMs: native.duration_ms,
        };
      }
      report.metadata.native = { engine: opts.engine, workers: nativeResults };
    } catch (error: any) {
      const message = error?.message || String(error);
      if (opts.engine !== 'all') {
        findings.push(
          finding({
            category: 'error',
            severity: 'CRITICAL',
            title: 'Native engine failed',
            detail: message,
          }),
        );
        report.findings = sortFindings(findings);
        report.metadata.native = { engine: opts.engine, error: message };
        return { report, exitCode: 2 };
      }
      report.metadata.native = {
        engine: 'typescript',
        fallback: message,
        workers: nativeResults,
      };
    }
  }

  let exitCode = 0;
  if (opts.failOn && report.metadata.worst && rank(report.metadata.worst) <= rank(opts.failOn)) {
    exitCode = 1;
  }
  return { report, exitCode };
}

function emptyReport(root: string, profile: any, started: number) {
  return {
    specVersion: SPEC_VERSION,
    tool: 'flamer',
    version: 2,
    project: {
      name: basename(root),
      kind: projectKind(profile),
      languages: profile.languages,
      packages: [],
    },
    findings: [],
    metadata: {
      generatedAt: new Date().toISOString(),
      durationSeconds: (Date.now() - started) / 1000,
    },
  };
}

const ANSI = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  yellow: '\u001b[33m',
  magenta: '\u001b[35m',
  cyan: '\u001b[36m',
  green: '\u001b[32m',
  gray: '\u001b[90m',
};

function colorEnabled(force: boolean | null) {
  if (force !== null) return force;
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
}

function paint(text: string, color: string, enabled: boolean) {
  return enabled ? `${color}${text}${ANSI.reset}` : text;
}

function severityColor(severity: string) {
  switch (severity) {
    case 'CRITICAL':
      return ANSI.red;
    case 'HIGH':
      return ANSI.yellow;
    case 'MEDIUM':
      return ANSI.magenta;
    case 'LOW':
      return ANSI.gray;
    default:
      return ANSI.cyan;
  }
}

function severityIcon(severity: string) {
  return severity === 'LOW' ? '·' : severity === 'INFO' ? 'i' : '!';
}

function printSummary(report: any, forceColor: boolean | null) {
  const enabled = colorEnabled(forceColor);
  const p = report.project;
  const out = [];
  const width = 62;
  const duration = report.metadata.durationSeconds;
  out.push('');
  out.push(
    ` ${paint('FLAMER', ANSI.bold + ANSI.cyan, enabled)}  ${paint(p.name, ANSI.bold, enabled)}`,
  );
  out.push(paint(` ${'─'.repeat(width)}`, ANSI.dim, enabled));
  if (p.languages?.length) {
    out.push(
      ` ${p.languages.map((l: any) => l.label).join(', ')} ${paint('·', ANSI.dim, enabled)} ` +
        `${(p.totalFiles || 0).toLocaleString()} files ${paint('·', ANSI.dim, enabled)} ` +
        `${(p.totalLines || 0).toLocaleString()} lines ${paint('·', ANSI.dim, enabled)} ${duration.toFixed(2)}s`,
    );
  } else {
    out.push(
      ` ${p.kind?.join(', ') || 'unknown'} ${paint('·', ANSI.dim, enabled)} ${duration.toFixed(2)}s`,
    );
  }
  out.push('');
  const sev = report.metadata.severities || {};
  for (const s of SEVERITIES) {
    if (sev[s]) {
      const label = `${severityIcon(s)} ${sev[s]} ${s.toLowerCase()}`;
      out.push(` ${paint(label, severityColor(s), enabled)}`);
    }
  }
  if (report.findings.length > 0) {
    out.push('');
    for (const severity of SEVERITIES) {
      const findings = report.findings.filter((f: any) => f.severity === severity);
      if (findings.length === 0) continue;
      out.push(` ${paint(severity, severityColor(severity), enabled)}`);
      for (const f of findings) {
        out.push(
          `  ${paint(severityIcon(f.severity), severityColor(f.severity), enabled)} ${f.title}`,
        );
        if (f.detail) out.push(`    ${paint(f.detail, ANSI.dim, enabled)}`);
        if (f.files?.length) {
          out.push(
            `    ${paint(f.files.slice(0, 5).join(', ') + (f.files.length > 5 ? ' ...' : ''), ANSI.gray, enabled)}`,
          );
        }
      }
    }
  }
  out.push('');
  out.push(paint(` ${'─'.repeat(width)}`, ANSI.dim, enabled));
  if (report.findings.length === 0) {
    out.push(` ${paint('✓ No findings · scan completed', ANSI.green, enabled)}`);
  } else {
    out.push(
      ` ${paint(`${report.findings.length} finding${report.findings.length === 1 ? '' : 's'} · scan completed`, ANSI.bold, enabled)}`,
    );
  }
  process.stdout.write(out.join('\n') + '\n');
}

for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err: any) => {
    if (err && err.code === 'EPIPE') process.exit(0);
    throw err;
  });
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) return printHelp();
  if (opts.listLanguages) return printLanguages();

  const { report, exitCode } = run(opts);

  const json = JSON.stringify(report, null, 2);
  if (opts.out) {
    try {
      writeFileSync(opts.out, json + '\n');
    } catch (e: any) {
      process.stderr.write(`warning: could not write ${opts.out}: ${e.message}\n`);
    }
  }

  if (opts.format === 'summary') {
    if (!opts.quiet) printSummary(report, opts.color);
  } else {
    process.stdout.write(json + '\n');
  }

  process.exitCode = exitCode;
}

main();
