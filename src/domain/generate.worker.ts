// Il generatore gira in un worker per non bloccare l'interfaccia.

import type { MonthContext } from './context';
import { generate } from './generator';
import type { Assignment } from './types';

self.onmessage = (event: MessageEvent<{ ctx: MonthContext; timeMs: number; locked: Assignment[] }>) => {
  const { ctx, timeMs, locked } = event.data;
  let last = 0;
  const result = generate(ctx, {
    timeMs,
    locked,
    onProgress: p => {
      if (p - last >= 0.04 || p === 1) { last = p; self.postMessage({ type: 'progress', value: p }); }
    },
  });
  self.postMessage({ type: 'done', result });
};
