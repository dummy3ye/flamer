import { spawn } from 'child_process';
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
  findings?: {
    category: string;
    severity: string;
    title: string;
    detail: string;
    files?: string[];
    count?: number;
    lang?: string;
  }[];
};

export function nativeWorkerPath(root: string, worker: NativeWorker) {
  const configured = worker === 'rust' ? process.env.FLAMER_RUST_CORE : process.env.FLAMER_CPP_CORE;
  if (configured) return configured;
  if (process.env.FLAMER_CORE && worker === 'rust') return process.env.FLAMER_CORE;
  return worker === 'rust'
    ? join(root, 'native', 'core', 'rust', 'target', 'release', 'flamer-core')
    : join(root, 'native', 'core', 'cpp', 'build', 'flamer-core-cpp');
}

export function runNativeWorker(
  root: string,
  files: string[],
  worker: NativeWorker,
  operation: 'file_metrics' | 'rust_analysis' | 'cpp_analysis' = 'file_metrics',
): Promise<NativeResponse> {
  const executable = nativeWorkerPath(root, worker);
  if (!existsSync(executable)) {
    return Promise.reject(
      new Error(`${worker} worker not found at ${executable}; build the native workers first`),
    );
  }

  const request = JSON.stringify({ protocol: 1, operation, root, files });
  return new Promise((resolve, reject) => {
    const child = spawn(executable, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`${worker} worker timed out`));
    }, 30_000);
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`${worker} worker failed: ${error.message}`));
    });
    child.on('close', (status) => {
      clearTimeout(timeout);
      if (status !== 0) {
        reject(new Error(`${worker} worker exited with status ${status}: ${stderr.trim()}`));
        return;
      }
      try {
        const response = JSON.parse(stdout) as NativeResponse;
        if (response.protocol !== 1 || response.operation !== operation) {
          throw new Error(`${worker} worker returned an incompatible response`);
        }
        if (!response.ok) {
          throw new Error(
            response.errors.map((error) => `${error.path}: ${error.message}`).join('; '),
          );
        }
        resolve(response);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    child.stdin.end(`${request}\n`);
  });
}
