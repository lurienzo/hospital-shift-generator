import { describe, expect, it } from 'vitest';
import { distinctColors } from './color';

const rgb = (hex: string) => hex.slice(1).match(/.{2}/g)!.map(x => parseInt(x, 16));
const dist = (a: string, b: string) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));

describe('colori dei medici', () => {
  it('dà colori validi, tutti diversi, e vicini nell’elenco ben distinti', () => {
    for (const n of [2, 5, 9, 14, 20]) {
      const c = distinctColors(n, 0.3);
      expect(c).toHaveLength(n);
      expect(new Set(c).size).toBe(n);
      for (const x of c) expect(x).toMatch(/^#[0-9a-f]{6}$/);
      for (let i = 1; i < n; i++) expect(dist(c[i - 1], c[i])).toBeGreaterThan(90);
    }
  });
});
