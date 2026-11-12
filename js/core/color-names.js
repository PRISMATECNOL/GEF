/**
 * GEF | NOME DA COR A PARTIR DO CÓDIGO (hex → "Azul-marinho", "Vermelho", "Cinzento claro"…)
 * Escolhe a cor mais próxima (distância em CIE Lab, que acompanha a percepção humana) de uma paleta em português.
 */
const PALETTE = [
  ['Preto', '#000000'], ['Branco', '#ffffff'], ['Branco-gelo', '#f5f5f0'], ['Cinzento muito claro', '#e5e5e5'], ['Cinzento claro', '#c0c0c0'],
  ['Cinzento', '#808080'], ['Cinzento escuro', '#4a4a4a'], ['Grafite', '#2b2b2b'], ['Prateado', '#b8bcc2'],
  ['Vermelho', '#e11d1d'], ['Vermelho escuro', '#8b0000'], ['Bordô', '#6d0f1f'], ['Carmesim', '#c8102e'], ['Coral', '#ff6f61'], ['Salmão', '#fa8072'],
  ['Rosa', '#ff69b4'], ['Rosa claro', '#ffc0cb'], ['Rosa choque', '#ff1493'], ['Magenta', '#d6006f'], ['Fúcsia', '#c71585'],
  ['Laranja', '#ff8c00'], ['Laranja escuro', '#d2691e'], ['Terracota', '#c0562f'], ['Pêssego', '#ffcba4'],
  ['Amarelo', '#ffd600'], ['Amarelo claro', '#fff59d'], ['Dourado', '#d4a017'], ['Mostarda', '#c9a227'], ['Creme', '#fff5cc'], ['Bege', '#d9c3a0'], ['Areia', '#e2c89b'],
  ['Castanho', '#7b4a21'], ['Castanho claro', '#a9744f'], ['Castanho escuro', '#4a2c14'], ['Chocolate', '#5a3825'], ['Cobre', '#b36b3b'], ['Caramelo', '#b5772f'],
  ['Verde', '#16a34a'], ['Verde claro', '#86efac'], ['Verde escuro', '#14532d'], ['Verde-lima', '#a3e635'], ['Verde-azeitona', '#6b7a2a'], ['Verde-menta', '#98e6c4'], ['Verde-água', '#2bb3a0'], ['Verde-militar', '#4b5320'], ['Verde-garrafa', '#0b4d32'],
  ['Turquesa', '#1cc7d0'], ['Azul-petróleo', '#0f5b6b'], ['Ciano', '#00bcd4'],
  ['Azul', '#1d4ed8'], ['Azul claro', '#8ec5ff'], ['Azul-céu', '#4fb3ff'], ['Azul escuro', '#1e3a8a'], ['Azul-marinho', '#0b1f4d'], ['Azul-royal', '#2347d6'], ['Azul-ardósia', '#5b7aa5'],
  ['Roxo', '#7e22ce'], ['Roxo escuro', '#4c1d95'], ['Violeta', '#8f5ce6'], ['Lilás', '#c9a7ee'], ['Lavanda', '#e3d5f7'], ['Púrpura', '#6a1b9a'], ['Ameixa', '#5b2a4e'],
  ['Azul', '#0000ff'], ['Azul', '#0a3cff'], ['Azul', '#2563eb'], ['Verde', '#00ff00'], ['Verde', '#00a000'], ['Vermelho', '#ff0000'], ['Verde-lima', '#b6f000'],
  ['Cor de madeira', '#9c6b3f'], ['Cor de cimento', '#9a9a94'], ['Cor de tijolo', '#a5432d'], ['Marfim', '#fffff0']
];

const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
function toLab(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = lin((n >> 16) & 255), g = lin((n >> 8) & 255), b = lin(n & 255);
  let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, y = (r * 0.2126 + g * 0.7152 + b * 0.0722), z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const LABS = PALETTE.map(([name, hex]) => ({ name, lab: toLab(hex) }));

/** Devolve o nome da cor mais próxima do código hex (#rrggbb). Vazio se o código for inválido. */
export function colorNameFromHex(hex) {
  if (!/^#[0-9a-fA-F]{6}$/.test(String(hex || ''))) return '';
  const l = toLab(hex);
  let best = LABS[0], bd = Infinity;
  for (const p of LABS) {
    const d = (p.lab[0] - l[0]) ** 2 + (p.lab[1] - l[1]) ** 2 + (p.lab[2] - l[2]) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return best.name;
}
