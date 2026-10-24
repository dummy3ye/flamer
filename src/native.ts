import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

export type NativeWorker = 'rust' | 'cpp';

type NativeResponse = {
  protocol: number;
  ok: boolean;
  operation: string;
  metrics: { files: number; bytes: number; lines: number };
  errors: { path: string; message: string }[];
  duration_ms: number;
};

export function nativeWorkerPath(root: string, worker: NativeWorker) {
  const configured = worker === 'rust' ? process.env.FLAMER_RUST_CORE : process.env.FLAMER_CPP_CORE;
  if (configured) return configured;
  if (process.env.FLAMER_CORE && worker === 'rust') return process.env.FLAMER_CORE;
  return worker === 'rust'
    ? join(root, 'native', 'core', 'rust', 'target', 'release', 'flamer-core')
    : join(root, 'native', 'core', 'cpp', 'build', 'flamer-core-cpp');
}

export function runNativeMetrics(
  root: string,
  files: string[],
  worker: NativeWorker,
): NativeResponse {
  const executable = nativeWorkerPath(root, worker);
  if (!existsSync(executable)) {
    throw new Error(`${worker} worker not found at ${executable}; build the native workers first`);
  }

  const request = JSON.stringify({ protocol: 1, operation: 'file_metrics', root, files });
  const result = spawnSync(executable, {
    input: `${request}\n`,
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.error) throw new Error(`${worker} worker failed: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(
      `${worker} worker exited with status ${result.status}: ${result.stderr.trim()}`,
    );
  }

  let response: NativeResponse;
  try {
    response = JSON.parse(result.stdout);
  } catch {
    throw new Error(`${worker} worker returned invalid JSON`);
  }
  if (response.protocol !== 1 || response.operation !== 'file_metrics') {
    throw new Error(`${worker} worker returned an incompatible response`);
  }
  if (!response.ok) {
    throw new Error(response.errors.map((error) => `${error.path}: ${error.message}`).join('; '));
  }
  return response;
}
