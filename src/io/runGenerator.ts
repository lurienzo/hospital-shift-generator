import type { MonthContext } from '../domain/context';
import { generate, type GenerateResult } from '../domain/generator';
import type { Assignment } from '../domain/types';

/** Esegue il generatore in un worker; se il browser non li supporta, nel thread principale. */
export function runGenerator(ctx: MonthContext, timeMs: number, locked: Assignment[], onProgress: (p: number) => void): Promise<GenerateResult> {
  if (typeof Worker === 'undefined') {
    return Promise.resolve(generate(ctx, { timeMs, locked, onProgress }));
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../domain/generate.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ type: 'progress'; value: number } | { type: 'done'; result: GenerateResult }>) => {
      if (e.data.type === 'progress') onProgress(e.data.value);
      else { resolve(e.data.result); worker.terminate(); }
    };
    worker.onerror = e => {
      worker.terminate();
      // Ripiego: stesso calcolo senza worker.
      try { resolve(generate(ctx, { timeMs, locked, onProgress })); } catch { reject(e); }
    };
    worker.postMessage({ ctx, timeMs, locked });
  });
}
