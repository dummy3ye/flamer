/**
 * Analyzer registry.
 *
 * Adding a check means adding one entry to this array (or one more file
 * exported through it). The runner in flamer.mjs does not change.
 *
 * Every analyzer has the shape:
 *   (ctx) => Finding[]
 * where ctx = { root, files, sourceFiles, rootFileNames, profile, gitTracked, options }
 *
 * Analyzers are isolated: if one throws, the runner records an error finding
 * and continues with the rest.
 */

/** @typedef {import('../util/findings.mjs').Finding} Finding */

import * as universal from './universal.mjs';
import * as testing from './testing.mjs';
import * as git from './git.mjs';
import * as node from './node.mjs';
import * as python from './python.mjs';
import * as systems from './systems.mjs';
import * as notebooks from './notebooks.mjs';
import * as scaffolding from './scaffolding.mjs';

export const ANALYZERS = [
  { id: 'universal', label: 'Universal (secrets, bloat, markers, hygiene)', fn: universal.analyze },
  { id: 'notebooks', label: 'Jupyter notebooks', fn: notebooks.analyze },
  { id: 'scaffolding', label: 'Project scaffolding & manifests', fn: scaffolding.analyze },
  { id: 'testing', label: 'Test coverage ratio', fn: testing.analyze },
  { id: 'git', label: 'Git history & tracked files', fn: git.analyze },
  { id: 'node', label: 'JavaScript / TypeScript', fn: node.analyze },
  { id: 'python', label: 'Python', fn: python.analyze },
  { id: 'systems', label: 'Rust / Go / C / C++ / C# / Zig', fn: systems.analyze },
];
