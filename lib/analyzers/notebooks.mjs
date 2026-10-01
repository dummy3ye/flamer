/**
 * Jupyter Notebook (.ipynb) checks.
 *
 * Notebooks are JSON, so a text analyzer that works by lines produces misleading
 * results on them (a minified notebook is one enormous "line"). This analyzer
 * parses the notebook structure instead.
 */
import { finding } from '../util/findings.mjs';
import { readText } from '../util/fs.mjs';

const fmtKB = (bytes) => `${Math.round(bytes / 1024)}KB`;

function cellText(cell) {
  const s = cell?.source;
  if (Array.isArray(s)) return s.join('');
  if (typeof s === 'string') return s;
  return '';
}

function outputText(output) {
  if (typeof output?.text === 'string') return output.text;
  if (Array.isArray(output?.text)) return output.text.join('');
  if (output?.data) {
    const d = output.data;
    return [...(d['text/plain'] || []), ...(d['text/html'] || [])].join(' ');
  }
  return '';
}

export function analyze(ctx) {
  const out = [];
  const notebooks = ctx.files.filter((f) => f.rel.endsWith('.ipynb'));
  if (notebooks.length === 0) return out;

  let withOutputs = 0;
  let runInOrder = 0;
  let embeddedImages = 0;
  let secretOutputs = 0;
  const bigNotebooks = [];
  const outputFiles = [];

  for (const nb of notebooks) {
    const raw = readText(nb.abs);
    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      out.push(
        finding({
          category: 'config',
          severity: 'HIGH',
          title: `Invalid JSON in notebook ${nb.rel}`,
          detail: 'The .ipynb could not be parsed. It is likely corrupt or was hand-edited.',
          files: [nb.rel],
        })
      );
      continue;
    }

    const cells = Array.isArray(json.cells) ? json.cells : [];
    let nbOutputs = 0;
    let nbImages = 0;
    let nbSecrets = 0;
    let nbRun = false;

    for (const cell of cells) {
      if (cell.execution_count != null) nbRun = true;
      for (const output of cell.outputs || []) {
        nbOutputs++;
        if (output.data?.['image/png'] || output.data?.['image/jpeg'] || output.data?.['application/octet-stream']) {
          nbImages++;
        }
        const text = outputText(output);
        if (/AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36}|-----BEGIN [A-Z ]*PRIVATE KEY|sk-[A-Za-z0-9]{32}/.test(text)) {
          nbSecrets++;
        }
        if (output.output_type === 'error') {
          nbOutputs++;
        }
      }
    }

    if (nbOutputs > 0) withOutputs++;
    if (nbRun) runInOrder++;
    if (nbImages > 0) embeddedImages++;
    if (nbSecrets > 0) secretOutputs++;
    if (nb.size > 300 * 1024) bigNotebooks.push({ rel: nb.rel, size: nb.size });
    if (nbOutputs > 0) outputFiles.push(nb.rel);
  }

  if (withOutputs > 0) {
    out.push(
      finding({
        category: 'bloat',
        severity: withOutputs / notebooks.length > 0.5 ? 'MEDIUM' : 'LOW',
        title: `${withOutputs}/${notebooks.length} notebook(s) committed with cell outputs`,
        detail:
          'Stored outputs (including base64 images) bloat the repo and can leak data that was printed during the run. ' +
          'Clear outputs before committing, or use nbstripout / a pre-commit hook.',
        files: outputFiles.slice(0, 8),
        count: withOutputs,
        lang: 'notebook',
      })
    );
  }

  if (embeddedImages > 0) {
    out.push(
      finding({
        category: 'bloat',
        severity: 'LOW',
        title: `${embeddedImages} notebook(s) contain embedded base64 image data`,
        detail: 'Plots stored as base64 PNGs. Each one is a permanent, uncompressible blob in git history.',
        count: embeddedImages,
        lang: 'notebook',
      })
    );
  }

  if (secretOutputs > 0) {
    out.push(
      finding({
        category: 'bloat',
        severity: 'CRITICAL',
        title: `Credential-looking data in ${secretOutputs} notebook output(s)`,
        detail: 'A cell printed something matching a credential pattern. Outputs are committed and shared. Rotate anything real.',
        count: secretOutputs,
        lang: 'notebook',
      })
    );
  }

  if (runInOrder > 0) {
    out.push(
      finding({
        category: 'hygiene',
        severity: 'LOW',
        title: `${runInOrder} notebook(s) saved with execution order intact`,
        detail: 'Non-null execution_count means cells were run top-to-bottom. Restart-and-run-all before sharing to prove the notebook is self-contained.',
        count: runInOrder,
        lang: 'notebook',
      })
    );
  }

  for (const b of bigNotebooks) {
    out.push(
      finding({
        category: 'bloat',
        severity: 'LOW',
        title: `Large notebook ${b.rel} (${fmtKB(b.size)})`,
        detail: 'Notebook over 300KB. Split exploratory work from the narrative, or push the data out and keep the notebook as a thin driver.',
        files: [b.rel],
        lang: 'notebook',
      })
    );
  }

  return out;
}
