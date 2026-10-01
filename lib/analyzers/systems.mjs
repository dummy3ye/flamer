/**
 * Systems languages: Rust, Go, C, C++, C#, Zig.
 *
 * These checks are intentionally conservative. They cover memory safety and
 * build config problems that other tooling does not already catch.
 */
import { join } from 'path';
import { finding } from '../util/findings.mjs';
import { readText, filesIn } from '../util/fs.mjs';

const fmt = (n) => n.toLocaleString('en-US');

function rust(ctx) {
  const out = [];
  const files = ctx.sourceFiles.filter((f) => f.lang === 'rust');
  if (files.length === 0) return out;

  const hasCargo = filesIn(ctx.root).includes('Cargo.toml');
  if (!hasCargo) {
    out.push(
      finding({
        category: 'build',
        severity: 'HIGH',
        title: 'Rust sources present but no Cargo.toml at the root',
        detail: 'These .rs files are not part of a Cargo build.',
        lang: 'rust',
      })
    );
  }

  // Cargo.lock should be committed for binaries, not libraries.
  const lockPresent = filesIn(ctx.root).includes('Cargo.lock');
  if (hasCargo && !lockPresent) {
    out.push(
      finding({
        category: 'deps',
        severity: 'MEDIUM',
        title: 'Cargo.lock not committed',
        detail: 'For a binary crate, committing Cargo.lock pins reproducible builds. (Libraries may omit it.)',
        files: ['Cargo.toml'],
        lang: 'rust',
      })
    );
  }

  const unwrapFiles = [];
  let unwrapCount = 0;
  for (const f of files) {
    const text = readText(f.abs);
    if (!text) continue;
    const n = (text.match(/\.unwrap\(\)/g) || []).length + (text.match(/\.expect\(/g) || []).length;
    if (n > 0) {
      unwrapCount += n;
      unwrapFiles.push({ rel: f.rel, n });
    }
  }
  if (unwrapCount > 0) {
    out.push(
      finding({
        category: 'bloat',
        severity: unwrapCount > 30 ? 'MEDIUM' : 'LOW',
        title: `${fmt(unwrapCount)} unwrap()/expect() call(s) across ${unwrapFiles.length} Rust file(s)`,
        detail:
          'These panic on failure. Concentrated use in library code turns bad input into a process crash. ' +
          unwrapFiles.sort((a, b) => b.n - a.n).slice(0, 5).map((f) => `${f.rel} (${f.n})`).join(', '),
        files: unwrapFiles.slice(0, 6).map((f) => f.rel),
        count: unwrapCount,
        lang: 'rust',
      })
    );
  }

  return out;
}

function go(ctx) {
  const out = [];
  const files = ctx.sourceFiles.filter((f) => f.lang === 'go');
  if (files.length === 0) return out;

  const hasMod = filesIn(ctx.root).includes('go.mod');
  if (!hasMod) {
    out.push(
      finding({
        category: 'build',
        severity: 'HIGH',
        title: 'Go sources present but no go.mod',
        detail: 'Go requires go.mod for module resolution and reproducible builds.',
        lang: 'go',
      })
    );
  } else if (!filesIn(ctx.root).includes('go.sum')) {
    out.push(
      finding({
        category: 'deps',
        severity: 'MEDIUM',
        title: 'go.mod present but no go.sum',
        detail: 'go.sum pins module checksums. Without it, dependency integrity is not verified.',
        files: ['go.mod'],
        lang: 'go',
      })
    );
  }

  // Ignored errors: `foo()` where error is discarded, or bare `_ =`
  const ignored = [];
  for (const f of files) {
    if (f.name.endsWith('_test.go')) continue;
    const text = readText(f.abs);
    if (!text) continue;
    // A call statement whose value is discarded, on a line that returns an error.
    const n = (text.match(/^\s*_\s*=\s*\w+\([^)]*\)\s*$/gm) || []).length;
    if (n > 0) ignored.push({ rel: f.rel, n });
  }
  if (ignored.length > 0) {
    const total = ignored.reduce((s, f) => s + f.n, 0);
    out.push(
      finding({
        category: 'hygiene',
        severity: total > 20 ? 'MEDIUM' : 'LOW',
        title: `${total} discarded error value(s) assigned to _ in Go`,
        detail:
          'Explicitly ignoring returned errors. Some is correct at boundaries, but volume like this usually hides real failures. ' +
          ignored.slice(0, 5).map((f) => `${f.rel} (${f.n})`).join(', '),
        files: ignored.slice(0, 6).map((f) => f.rel),
        count: total,
        lang: 'go',
      })
    );
  }

  return out;
}

/** Memory safety checks for C and C++ sources. */
function dotnet(ctx) {
  const out = [];
  const cs = ctx.sourceFiles.filter((f) => f.lang === 'csharp');
  const projects = ctx.files.filter((f) => /\.csproj$|\.sln$|\.fsproj$|\.vbproj$/.test(f.rel));
  if (cs.length === 0 && projects.length === 0) return out;

  if (projects.length === 0 && cs.length > 0) {
    out.push(
      finding({
        category: 'build',
        severity: 'HIGH',
        title: 'C# sources present but no .csproj or .sln',
        detail: 'No project file found. dotnet build will not discover these sources.',
        lang: 'csharp',
      })
    );
  }

  const csprojNoNullable = [];
  for (const p of projects.filter((x) => /\.csproj$/.test(x.rel))) {
    const raw = readText(p.abs);
    if (/<Nullable>/.test(raw) && /<Nullable>disable<\/Nullable>/.test(raw)) csprojNoNullable.push(p.rel);
  }
  if (cs.length > 3 && csprojNoNullable.length > 0) {
    out.push(
      finding({
        category: 'config',
        severity: 'MEDIUM',
        title: `${csprojNoNullable.length} C# project(s) with nullable reference types disabled`,
        detail: `<Nullable>disable</Nullable> in ${csprojNoNullable.join(', ')}. NullReferenceException risks stay invisible to the compiler.`,
        files: csprojNoNullable,
        lang: 'csharp',
      })
    );
  }

  if (projects.length > 0 && !filesIn(ctx.root).includes('global.json')) {
    out.push(
      finding({
        category: 'build',
        severity: 'LOW',
        title: 'No global.json pinning the .NET SDK version',
        detail: 'Different machines/CI runners may build against different SDKs.',
        lang: 'csharp',
      })
    );
  }

  return out;
}

function zig(ctx) {
  const out = [];
  const files = ctx.sourceFiles.filter((f) => f.lang === 'zig');
  if (files.length === 0) return out;
  if (!filesIn(ctx.root).includes('build.zig')) {
    out.push(
      finding({
        category: 'build',
        severity: 'MEDIUM',
        title: 'Zig sources present but no build.zig',
        detail: 'No build script. Zig projects are conventionally driven by build.zig.',
        lang: 'zig',
      })
    );
  }
  return out;
}

export function analyze(ctx) {
  return [...rust(ctx), ...go(ctx), ...dotnet(ctx), ...zig(ctx)];
}
