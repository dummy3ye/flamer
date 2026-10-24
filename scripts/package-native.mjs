import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const target = process.argv[2];
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const version = process.argv[3] ?? packageJson.version;

if (!/^(linux|darwin|win32)-(x64|arm64)$/.test(target ?? '')) {
  console.error('usage: node scripts/package-native.mjs <platform-arch> [version]');
  process.exit(2);
}

const output = join(root, 'native', 'packages', target);
const extension = target.startsWith('win32-') ? '.exe' : '';
const rust = join(root, 'native', 'core', 'rust', 'target', 'release', `flamer-core${extension}`);
const cppRoot = join(root, 'native', 'core', 'cpp', 'build');
const cppCandidates = [
  join(cppRoot, `flamer-core-cpp${extension}`),
  join(cppRoot, 'Release', `flamer-core-cpp${extension}`),
];
const cpp = cppCandidates.find((candidate) => existsSync(candidate)) ?? cppCandidates[0];
if (!existsSync(rust) || !existsSync(cpp)) {
  throw new Error(`build both native workers before packaging ${target}`);
}

await rm(output, { recursive: true, force: true });
await mkdir(join(output, 'bin'), { recursive: true });
await cp(rust, join(output, 'bin', `flamer-core${extension}`));
await cp(cpp, join(output, 'bin', `flamer-core-cpp${extension}`));
await writeFile(
  join(output, 'package.json'),
  `${JSON.stringify(
    {
      name: `@dummy3ye/flamer-native-${target}`,
      version,
      description: `Flamer native workers for ${target}`,
      license: 'MIT',
      repository: {
        type: 'git',
        url: 'https://github.com/dummy3ye/flamer.git',
      },
      homepage: 'https://github.com/dummy3ye/flamer#readme',
      os: [target.split('-')[0]],
      cpu: [target.split('-')[1]],
      files: ['bin'],
      exports: {
        './rust': `./bin/flamer-core${extension}`,
        './cpp': `./bin/flamer-core-cpp${extension}`,
      },
    },
    null,
    2,
  )}\n`,
);

console.log(`Packaged @dummy3ye/flamer-native-${target}@${version} in ${output}`);
