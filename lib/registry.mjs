/**
 * Language & ecosystem registry.
 *
 * This table is the single source of truth for what the analyzer understands.
 * Adding a language means adding one entry here plus (optionally) an analyzer
 * in lib/analyzers/. Nothing else needs to change.
 *
 * Entry shape:
 *   id            unique key, also used in output as `lang`
 *   label         readable name
 *   exts          file extensions (lowercase, written with a leading dot)
 *   filenames     exact basenames treated as this language (config/manifests)
 *   comment       { line, block: [[open, close], ...] } for marker/comment parsing
 *                 (written without a literal block terminator to avoid
 *                  accidentally closing this doc comment)
 *   bloat         { soft, hard } line counts. soft adapts, hard is absolute
 *   tests         RegExp[] matched against paths relative to the repo root
 *   manifests     manifest/entrypoint filenames that indicate this ecosystem
 *   linters       config filenames that prove linting is configured
 *   lockfiles     lockfiles that pin this ecosystem
 */

/** Languages are grouped so output can report "this is a Rust repo" cleanly. */
export const LANGUAGES = [
  {
    id: 'javascript',
    label: 'JavaScript',
    exts: ['.js', '.jsx', '.mjs', '.cjs'],
    filenames: ['package.json'],
    comment: { line: '//', block: [['/*', '*/']] },
    bloat: { soft: 300, hard: 700 },
    tests: [/\.(test|spec)\.(js|jsx|mjs|cjs)$/, /(^|\/)__tests__\//, /(^|\/)test(s)?\//],
    manifests: ['package.json'],
    linters: ['.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.cjs', 'eslint.config.js', 'eslint.config.mjs', 'biome.json'],
    lockfiles: ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb'],
  },
  {
    id: 'typescript',
    label: 'TypeScript',
    exts: ['.ts', '.tsx', '.mts', '.cts'],
    filenames: ['tsconfig.json'],
    comment: { line: '//', block: [['/*', '*/']] },
    bloat: { soft: 300, hard: 700 },
    tests: [/\.(test|spec)\.(ts|tsx|mts|cts)$/, /(^|\/)__tests__\//],
    manifests: ['tsconfig.json'],
    linters: ['tsconfig.json'],
    lockfiles: ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb'],
  },
  {
    id: 'python',
    label: 'Python',
    exts: ['.py', '.pyi', '.pyw'],
    filenames: ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'Pipfile', 'poetry.lock'],
    comment: { line: '#', block: [] },
    bloat: { soft: 400, hard: 900 },
    tests: [/(^|\/)tests?\//, /(^|\/)test_.*\.py$/, /_test\.py$/, /(^|\/)conftest\.py$/],
    manifests: ['pyproject.toml', 'setup.py', 'requirements.txt', 'Pipfile', 'setup.cfg'],
    linters: ['.flake8', 'ruff.toml', '.ruff.toml', 'mypy.ini', '.pylintrc', 'pyproject.toml'],
    lockfiles: ['poetry.lock', 'Pipfile.lock', 'uv.lock', 'requirements.lock', 'pdm.lock'],
  },
  {
    id: 'rust',
    label: 'Rust',
    exts: ['.rs'],
    filenames: ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', 'clippy.toml', 'rustfmt.toml'],
    comment: { line: '//', block: [['/*', '*/']] },
    bloat: { soft: 450, hard: 1000 },
    tests: [/(^|\/)tests?\//, /_test\.rs$/, /\/tests\/.*\.rs$/],
    manifests: ['Cargo.toml'],
    linters: ['clippy.toml', 'rustfmt.toml', '.rustfmt.toml', 'deny.toml'],
    lockfiles: ['Cargo.lock'],
  },
  {
    id: 'go',
    label: 'Go',
    exts: ['.go'],
    filenames: ['go.mod', 'go.sum', 'go.work'],
    comment: { line: '//', block: [['/*', '*/']] },
    bloat: { soft: 450, hard: 900 },
    tests: [/_test\.go$/, /(^|\/)tests?\//],
    manifests: ['go.mod', 'go.work'],
    linters: ['.golangci.yml', '.golangci.yaml', 'golangci.yml'],
    lockfiles: ['go.sum'],
  },
  {
    id: 'c',
    label: 'C',
    exts: ['.c', '.h'],
    filenames: ['Makefile', 'makefile', 'CMakeLists.txt', 'meson.build', 'configure.ac'],
    comment: { line: '//', block: [['/*', '*/']] },
    bloat: { soft: 500, hard: 1200 },
    tests: [/(^|\/)tests?\//, /(^|\/)test_[^/]+\.c$/, /_test\.c$/],
    manifests: ['Makefile', 'CMakeLists.txt', 'meson.build', 'configure.ac'],
    linters: ['.clang-format', '.clang-tidy', '.editorconfig'],
    lockfiles: ['conan.lock', 'conanfile.txt'],
  },
  {
    id: 'cpp',
    label: 'C++',
    exts: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx', '.ipp', '.tpp', '.mm'],
    filenames: ['CMakeLists.txt'],
    comment: { line: '//', block: [['/*', '*/']] },
    bloat: { soft: 500, hard: 1200 },
    tests: [/(^|\/)tests?\//, /_test\.cc$|test.*\.cpp$/],
    manifests: ['CMakeLists.txt', 'meson.build'],
    linters: ['.clang-format', '.clang-tidy'],
    lockfiles: ['conan.lock'],
  },
  {
    id: 'csharp',
    label: 'C#',
    exts: ['.cs', '.csx', '.vb', '.fs'],
    // .editorconfig is deliberately absent: it is not tied to one ecosystem and would
    // make every repo that has one look like a C# project.
    filenames: ['global.json', 'Directory.Build.props'],
    comment: { line: '//', block: [['/*', '*/']] },
    bloat: { soft: 400, hard: 900 },
    tests: [/\.Tests?\/.*\.cs$/, /(^|\/)tests?\//, /Tests\.cs$/],
    manifests: ['.sln', 'global.json'],
    linters: ['.editorconfig', 'stylecop.json', '.globalconfig'],
    lockfiles: ['packages.lock.json'],
  },
  {
    id: 'java',
    label: 'Java / JVM',
    exts: ['.java', '.kt', '.kts', '.scala', '.sc', '.groovy', '.clj', '.cljs'],
    filenames: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle'],
    comment: { line: '//', block: [['/*', '*/']] },
    bloat: { soft: 450, hard: 1000 },
    tests: [/(^|\/)src\/test\//, /(^|\/)tests?\//, /Test\.java$|Tests\.kt$/],
    manifests: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
    linters: ['checkstyle.xml', 'spotbugs-exclude.xml', 'ktlint', '.editorconfig'],
    lockfiles: ['gradle.lockfile', 'pom.xml'],
  },
  {
    id: 'ruby',
    label: 'Ruby',
    exts: ['.rb', '.rake', '.gemspec'],
    filenames: ['Gemfile', 'Gemfile.lock', 'Rakefile', '.ruby-version'],
    comment: { line: '#', block: [] },
    bloat: { soft: 350, hard: 800 },
    tests: [/(^|\/)spec\//, /_spec\.rb$/, /(^|\/)test(s)?\//],
    manifests: ['Gemfile', '*.gemspec'],
    linters: ['.rubocop.yml', '.standard.yml'],
    lockfiles: ['Gemfile.lock'],
  },
  {
    id: 'php',
    label: 'PHP',
    exts: ['.php', '.phtml'],
    filenames: ['composer.json', 'composer.lock', 'artisan', 'phpunit.xml'],
    comment: { line: '//', block: [['/*', '*/'], ['#', '#']] },
    bloat: { soft: 450, hard: 1000 },
    tests: [/(^|\/)tests?\//, /Test\.php$/],
    manifests: ['composer.json'],
    linters: ['phpcs.xml', 'phpcs.xml.dist', '.php-cs-fixer.php', 'phpstan.neon'],
    lockfiles: ['composer.lock'],
  },
  {
    id: 'shell',
    label: 'Shell',
    exts: ['.sh', '.bash', '.zsh', '.fish', '.ksh'],
    filenames: [],
    comment: { line: '#', block: [],
    },
    bloat: { soft: 250, hard: 600 },
    tests: [/(^|\/)tests?\//, /\.bats$/, /\.shspec$/],
    manifests: [],
    linters: ['.shellcheckrc', '.editorconfig'],
    lockfiles: [],
  },
  {
    id: 'powershell',
    label: 'PowerShell',
    exts: ['.ps1', '.psm1', '.psd1'],
    filenames: [],
    comment: { line: '#', block: [
      ['<#', '#>'],
    ] },
    bloat: { soft: 300, hard: 700 },
    tests: [/\.Tests\.ps1$/, /(^|\/)tests?\//],
    manifests: [],
    linters: ['PSScriptAnalyzerSettings.psd1', '.editorconfig'],
    lockfiles: [],
  },
  {
    id: 'sql',
    label: 'SQL',
    exts: ['.sql', '.ddl', '.dml'],
    filenames: [],
    comment: { line: '--', block: [['/*', '*/']] },
    bloat: { soft: 600, hard: 1500 },
    tests: [/(^|\/)tests?\//, /_test\.sql$/],
    manifests: [],
    linters: ['.sqlfluff', '.editorconfig'],
    lockfiles: [],
  },
  {
    id: 'terraform',
    label: 'Terraform / HCL',
    exts: ['.tf', '.tfvars', '.hcl'],
    filenames: ['.terraformrc', 'terragrunt.hcl', 'Chart.yaml', 'values.yaml'],
    comment: { line: '#', block: [['/*', '*/']] },
    bloat: { soft: 300, hard: 700 },
    tests: [/(^|\/)tests?\//, /_test\.go$/, /\.tftest\.hcl$/],
    manifests: ['main.tf', 'versions.tf', 'providers.tf'],
    linters: ['.tflint.hcl', '.checkov.yaml', '.pre-commit-config.yaml'],
    lockfiles: ['.terraform.lock.hcl'],
  },
  {
    id: 'docker',
    label: 'Docker',
    exts: ['.dockerfile'],
    filenames: ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', '.dockerignore'],
    comment: { line: '#', block: [],
    },
    bloat: { soft: 120, hard: 300 },
    tests: [],
    manifests: ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml'],
    linters: ['.hadolint.yaml', '.dockerignore'],
    lockfiles: [],
  },
  {
    id: 'notebook',
    label: 'Jupyter Notebook',
    exts: ['.ipynb'],
    filenames: [],
    comment: { line: '#', block: [],
    },
    bloat: { soft: 400, hard: 1200 },
    tests: [],
    manifests: [],
    linters: [],
    lockfiles: [],
  },
  {
    id: 'swift',
    label: 'Swift / Apple',
    exts: ['.swift'],
    filenames: ['Package.swift', 'Podfile'],
    comment: { line: '//', block: [['/*', '*/']] },
    bloat: { soft: 400, hard: 900 },
    tests: [/(^|\/)Tests?\//, /Tests\.swift$/],
    manifests: ['Package.swift', 'Podfile'],
    linters: ['.swiftlint.yml', '.swiftformat'],
    lockfiles: ['Podfile.lock', 'Package.resolved'],
  },
  {
    id: 'dart',
    label: 'Dart / Flutter',
    exts: ['.dart'],
    filenames: ['pubspec.yaml', 'analysis_options.yaml'],
    comment: { line: '//', block: [['/*', '*/']] },
    bloat: { soft: 400, hard: 900 },
    tests: [/(^|\/)test\//, /_test\.dart$/],
    manifests: ['pubspec.yaml'],
    linters: ['analysis_options.yaml'],
    lockfiles: ['pubspec.lock'],
  },
  {
    id: 'haskell',
    label: 'Haskell',
    exts: ['.hs', '.lhs'],
    filenames: ['stack.yaml', '*.cabal', 'cabal.project'],
    comment: { line: '--', block: [['{-', '-}']] },
    bloat: { soft: 300, hard: 700 },
    tests: [/(^|\/)test(s)?\//, /Spec\.hs$/, /\/test\/.*\.hs$/],
    manifests: ['stack.yaml', 'cabal.project', '*.cabal'],
    linters: ['.hlint.yaml', 'fourmolu.yaml'],
    lockfiles: ['cabal.project.freeze', 'flake.lock'],
  },
  {
    id: 'elixir',
    label: 'Elixir',
    exts: ['.ex', '.exs', '.eex', '.heex'],
    filenames: ['mix.exs', 'mix.lock'],
    comment: { line: '#', block: [],
    },
    bloat: { soft: 300, hard: 700 },
    tests: [/(^|\/)test\//, /_test\.exs?$/],
    manifests: ['mix.exs'],
    linters: ['.credo.exs', '.formatter.exs'],
    lockfiles: ['mix.lock'],
  },
  {
    id: 'lua',
    label: 'Lua',
    exts: ['.lua'],
    filenames: ['.luacheckrc', '*.rockspec'],
    comment: { line: '--', block: [['--[[', ']]']] },
    bloat: { soft: 300, hard: 700 },
    tests: [/(^|\/)spec\//, /_spec\.lua$/],
    manifests: ['*.rockspec'],
    linters: ['.luacheckrc'],
    lockfiles: [],
  },
  {
    id: 'r',
    label: 'R',
    exts: ['.r', '.rmd'],
    filenames: ['DESCRIPTION', 'renv.lock'],
    comment: { line: '#', block: [],
    },
    bloat: { soft: 400, hard: 900 },
    tests: [/(^|\/)tests?\//, /testthat\.R$/, /_test\.R$/],
    manifests: ['DESCRIPTION'],
    linters: ['.lintr', 'renv.lock'],
    lockfiles: ['renv.lock'],
  },
  {
    id: 'solidity',
    label: 'Solidity',
    exts: ['.sol'],
    filenames: ['hardhat.config.js', 'hardhat.config.ts', 'foundry.toml'],
    comment: { line: '//', block: [['/*', '*/']] },
    bloat: { soft: 400, hard: 900 },
    tests: [/\.t\.sol$/, /(^|\/)test\//],
    manifests: ['foundry.toml', 'hardhat.config.js'],
    linters: ['solhint.json', '.solhint.json'],
    lockfiles: ['pnpm-lock.yaml', 'package-lock.json'],
  },
  {
    id: 'zig',
    label: 'Zig',
    exts: ['.zig'],
    filenames: ['build.zig', 'build.zig.zon'],
    comment: { line: '//', block: [],
    },
    bloat: { soft: 400, hard: 900 },
    tests: [/(^|\/)test\//],
    manifests: ['build.zig'],
    linters: [],
    lockfiles: ['build.zig.zon'],
  },
];

/** ext (lowercase) -> language id. First language in the list wins on dup. */
export const EXT_MAP = (() => {
  const map = new Map();
  for (const lang of LANGUAGES) {
    for (const ext of lang.exts) {
      if (!map.has(ext)) map.set(ext, lang.id);
    }
  }
  return map;
})();

/** basename (lowercase) -> language id, for files matched by name. */
export const FILENAME_MAP = (() => {
  const map = new Map();
  for (const lang of LANGUAGES) {
    for (const name of lang.filenames) {
      const key = name.toLowerCase();
      if (!map.has(key)) map.set(key, lang.id);
    }
  }
  return map;
})();

/**
 * @typedef {object} LangMatch
 * @property {object|null} lang
 * @property {'ext'|'filename'|null} via
 */

/**
 * Resolve the language for a path relative to the repo root.
 *
 * `via` distinguishes a real source file (matched by extension) from a config
 * or manifest file (matched by basename). Manifests are excluded from source
 * statistics, otherwise `requirements.txt` inflates the Python line count and
 * `Makefile` inflates C counts.
 *
 * @param {string} relPath
 * @returns {LangMatch}
 */
export function matchLang(relPath) {
  const dot = relPath.lastIndexOf('.');
  const slash = relPath.lastIndexOf('/');
  if (dot > slash && dot !== -1) {
    const ext = relPath.slice(dot).toLowerCase();
    const id = EXT_MAP.get(ext);
    if (id) return { lang: LANGUAGES.find((l) => l.id === id), via: 'ext' };
  }
  const base = relPath.slice(relPath.lastIndexOf('/') + 1).toLowerCase();
  const id = FILENAME_MAP.get(base);
  if (id) return { lang: LANGUAGES.find((l) => l.id === id), via: 'filename' };
  return { lang: null, via: null };
}

export function languageById(id) {
  return LANGUAGES.find((l) => l.id === id) || null;
}

/** Every extension known to the registry, for `--list-languages` output. */
export function allExtensions() {
  return [...EXT_MAP.keys()].sort();
}
