import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

export type NativeEngine = 'typescript' | 'native' | 'auto';

type NativeResponse = {
  protocol: number;
  ok: boolean;
  operation: string;
  metrics: { files: number; bytes: number; lines: number };
  errors: { path: string; message: string }[];
  duration_ms: number;
};

export function nativeWorkerPath(root: string) {
  const configured = process.env.FLAMER_CORE;
  if (configured) return configured;
  return join(root, 'native', 'core', 'rust', 'target', 'release', 'flamer-core');
}

export function runNativeMetrics(root: string, files: string[]): NativeResponse {
  const worker = nativeWorkerPath(root);
  if (!existsSync(worker)) {
    throw new Error(`native worker not found at ${worker}; run npm run native:build`);
  }

  const request = JSON.stringify({ protocol: 1, operation: 'file_metrics', root, files });
  const result = spawnSync(worker, { input: `${request}\n`, encoding: 'utf8', timeout: 30_000 });
  if (result.error) throw new Error(`native worker failed: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`native worker exited with status ${result.status}: ${result.stderr.trim()}`);
  }

  let response: NativeResponse;
  try {
    response = JSON.parse(result.stdout);
  } catch {
    throw new Error('native worker returned invalid JSON');
  }
  if (response.protocol !== 1 || response.operation !== 'file_metrics') {
    throw new Error('native worker returned an incompatible response');
  }
  if (!response.ok) {
    throw new Error(response.errors.map((error) => `${error.path}: ${error.message}`).join('; '));
  }
  return response;
}
