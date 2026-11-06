/** Colore del testo leggibile su uno sfondo. */
export function textOn(hex: string): string {
  const m = hex.replace('#', '').match(/.{2}/g);
  if (!m) return '#fff';
  const [r, g, b] = m.map(x => parseInt(x, 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? '#111827' : '#ffffff';
}

/** Da OKLCH (spazio percettivo: distanze uguali = differenze viste uguali) a esadecimale sRGB. */
function oklchToHex(L: number, C: number, hueDeg: number): string {
  for (let c = C; c >= 0; c -= 0.005) {
    const h = (hueDeg * Math.PI) / 180;
    const a = c * Math.cos(h), b = c * Math.sin(h);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const rgb = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
    // Fuori dalla gamma dello schermo: si riduce la saturazione.
    if (rgb.some(x => x < -0.0001 || x > 1.0001)) continue;
    return '#' + rgb.map(x => {
      const v = Math.min(1, Math.max(0, x));
      const g = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
      return Math.round(g * 255).toString(16).padStart(2, '0');
    }).join('');
  }
  return '#888888';
}

/**
 * n colori il più possibile diversi fra loro: tonalità equidistanti in uno
 * spazio percettivo e, oltre i 9 medici, due luminosità alternate (chiaro e
 * scuro) per raddoppiare le differenze. L'ordine è rimescolato in modo che
 * due medici vicini nell'elenco, e quindi nelle colonne del calendario, non
 * abbiano mai tinte simili. offset (0–1) ruota la ruota dei colori: ogni
 * valore dà una combinazione diversa.
 */
export function distinctColors(n: number, offset = 0): string[] {
  if (n <= 0) return [];
  const two = n > 9;
  const base = offset * 360;
  const colors = Array.from({ length: n }, (_, i) => {
    const hue = base + (360 * i) / n;
    const dark = two && i % 2 === 1;
    return oklchToHex(dark ? 0.5 : 0.66, dark ? 0.14 : 0.16, hue % 360);
  });
  // Passo lungo e primo con n: consecutivi lontani sulla ruota.
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  let step = Math.max(1, Math.round(n * 0.382));
  while (n > 2 && gcd(step, n) !== 1) step++;
  return Array.from({ length: n }, (_, i) => colors[(i * step) % n]);
}
