import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  outDir: 'dist',
  clean: true,
  target: 'node18',
  splitting: false,
  shims: false,
});
