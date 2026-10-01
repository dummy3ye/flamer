#!/usr/bin/env node

/**
 * flamer is a language neutral code health auditor.
 *
 * Walks a repository once, runs every registered analyzer, and prints a JSON
 * report. Findings are factual; the roast is composed separately (see
 * SKILL.md). Works on any repo layout: single package, monorepo, or polyglot.
 *
 * Usage:
 *   node flamer.mjs [path] [options]
 *
 * Options:
 *   --package <name>    only analyze the named subproject (alias: --scope)
 *   --path <dir>        repository root (default: cwd)
 *   --format <fmt>      json (default) | summary
 *   --out <file>        write the JSON report to a file
 *   --fail-on <sev>     exit nonzero if any finding is at/above this severity
 *   --max-files <n>     stop walking after n files (default 60000)
 *   --commit-limit <n>  how many commits to inspect (default 1000)
 *   --no-git            skip git analysis
 *   --no-lockfile-warning  skip the "no lockfile" suggestion
 *   --list-languages    print the supported language/ecosystem table
 *   --quiet             suppress the human summary (JSON still printed)
 */

import { writeFileSync, existsSync } from 'fs';
import { resolve, basename, join } from 'path';

import { walkTree, filesIn, isDir } from './lib/util/fs.mjs';
import { finding, sortFindings, severityTally, worstSeverity, SEVERITIES, rank } from './lib/util/findings.mjs';
import { detectScopes, buildProfile, projectKind } from './lib/detect.mjs';
import { scanFile, isSource, isLineStructured } from './lib/scan.mjs';
import { ANALYZERS } from './lib/analyzers/index.mjs';
import * as git from './lib/util/git.mjs';
import { LANGUAGES, allExtensions } from './lib/registry.mjs';

/**
 * The version of docs/SPEC.md this build was written against. Carried in the
 * output so that drift between flamer and poison is visible in the data
 * instead of surfacing as a broken consumer script.
 */
const SPEC_VERSION = 1;

function parseArgs(argv) {
  const opts = {
    root: process.cwd(),
    format: 'json',
    out: null,
    failOn: null,
    maxFiles: 60000,
    commitLimit: 1000,
    noGit: false,
    noLockfileWarning: false,
    quiet: false,
    scope: null,
    listLanguages: false,
    help: false,
    ignoreDirs: [],
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
      case '--list-languages':
        opts.listLanguages = true;
        break;
      case '-h':
      case '--help':
        opts.help = true;
        break;
      default:
        if (a.startsWith('-')) {
          // An unknown flag must not be ignored: the next argument would
          // otherwise be swallowed as the target path and the scan would
          // silently run against the wrong directory.
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
  node flamer.mjs [path] [options]

Options:
  --package, --scope <name>  analyze only the named sub-project
  --path <dir>               repository root (default: cwd)
  --format <json|summary>    output format (default: json)
  --out <file>               also write the JSON report to a file
  --fail-on <SEVERITY>       exit 1 if a finding is at/above this severity
                            (${SEVERITIES.join(' | ')})
  --max-files <n>            stop walking after n files (default ${60000})
  --commit-limit <n>         commits to inspect for git analysis (default 1000)
  --no-git                   skip git analysis entirely
  --no-lockfile-warning      skip the "no lockfile" suggestion
  --ignore-dir <name>        also skip this directory name (repeatable)
  --quiet                    suppress the human summary
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

function run(opts) {
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
  let files = [];
  let truncated = false;
  const collected = [];
  const walk = walkTree(root, {
    extraIgnores: new Set(opts.ignoreDirs),
    onFile: (rec) => {
      if (collected.length >= opts.maxFiles) {
        truncated = true;
        return;
      }
      collected.push(scanFile(rec));
    },
  });
  files = collected;
  const walkMs = Date.now() - walkStart;

  const profile = buildProfile(root, detected, files);

  let scopes = profile.scopes;
  let scopedFiles = files;
  if (opts.scope) {
    const match = scopes.find((s) => s.name === opts.scope);
    if (!match) {
      const available = scopes.map((s) => s.name || 'root').join(', ') || 'none';
      const rep = emptyReport(root, profile, started);
      rep.findings.push(
        finding({
          category: 'error',
          severity: 'LOW',
          title: `Scope "${opts.scope}" not found`,
          detail: `Available scopes: ${available}.`,
        })
      );
      return { report: rep, exitCode: 0 };
    }
    scopes = [match];
    // Narrow the walked file set to this scope so counts, bloat stats and test
    // ratios describe only the requested subproject.
    if (match.path) {
      const prefix = `${match.path}/`;
      scopedFiles = files.filter((f) => f.rel === match.path || f.rel.startsWith(prefix));
    }
  }

  const sourceFiles = scopedFiles.filter(isSource);
  const structuredFiles = scopedFiles.filter(isLineStructured);
  const rootFileNames = new Set(filesIn(root));
  // across the repo source count, unaffected by --package scoping.
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

  const findings = [];
  const analyzerResults = [];
  for (const a of ANALYZERS) {
    const t0 = Date.now();
    try {
      const res = a.fn(ctx) || [];
      findings.push(...res);
      analyzerResults.push({ id: a.id, label: a.label, findings: res.length, ms: Date.now() - t0, error: null });
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      findings.push(
        finding({
          category: 'error',
          severity: 'LOW',
          title: `Analyzer "${a.id}" failed`,
          detail: msg,
        })
      );
      analyzerResults.push({ id: a.id, label: a.label, findings: 0, ms: Date.now() - t0, error: msg });
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
      packages: scopes.map((s) => s.name || 'root'),
      totalFiles: scopedFiles.length,
      totalSourceFiles: sourceFiles.length,
      totalLines: sourceFiles.reduce((s, f) => s + (f.lines || 0), 0),
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

  let exitCode = 0;
  if (opts.failOn && report.metadata.worst && rank(report.metadata.worst) <= rank(opts.failOn)) {
    exitCode = 1;
  }
  return { report, exitCode };
}

function emptyReport(root, profile, started) {
  return {
    specVersion: SPEC_VERSION,
    tool: 'flamer',
    version: 2,
    project: { name: basename(root), kind: projectKind(profile), languages: profile.languages, packages: [] },
    findings: [],
    metadata: { generatedAt: new Date().toISOString(), durationSeconds: (Date.now() - started) / 1000 },
  };
}

function printSummary(report) {
  const p = report.project;
  const out = [];
  out.push(`Project: ${p.name}  [${p.kind.join(', ')}]  layout=${p.layout}`);
  if (p.languages?.length) {
    out.push(`Languages: ${p.languages.map((l) => l.label).join(', ')}`);
  }
  out.push(`Files: ${(p.totalFiles || 0).toLocaleString()} (${(p.totalSourceFiles || 0).toLocaleString()} source, ${(p.totalLines || 0).toLocaleString()} lines)`);
  out.push(`Findings: ${report.findings.length}  worst=${report.metadata.worst || 'none'}`);
  out.push('');
  const sev = report.metadata.severities || {};
  for (const s of SEVERITIES) {
    if (sev[s]) out.push(`  ${s.padEnd(9)} ${sev[s]}`);
  }
  out.push('');
  for (const f of report.findings) {
    out.push(`[${f.severity}] (${f.category}) ${f.title}`);
    if (f.detail) out.push(`    ${f.detail}`);
    if (f.files?.length) out.push(`    files: ${f.files.slice(0, 5).join(', ')}${f.files.length > 5 ? ' ...' : ''}`);
  }
  process.stderr.write(out.join('\n') + '\n');
}

// Piping into head/less closes stdout early. Node turns that into an
// unhandled EPIPE and exits nonzero, so a perfectly normal
// `flamer.mjs --list-languages | head` would look like a crash.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err) => {
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
    } catch (e) {
      process.stderr.write(`warning: could not write ${opts.out}: ${e.message}\n`);
    }
  }

  if (opts.format === 'summary') {
    if (!opts.quiet) printSummary(report);
  } else {
    process.stdout.write(json + '\n');
  }

  process.exitCode = exitCode;
}

main();
