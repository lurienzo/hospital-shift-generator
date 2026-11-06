/** Colore del testo leggibile su uno sfondo. */
export function textOn(hex: string): string {
  const m = hex.replace('#', '').match(/.{2}/g);
  if (!m) return '#fff';
  const [r, g, b] = m.map(x => parseInt(x, 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? '#111827' : '#ffffff';
}
