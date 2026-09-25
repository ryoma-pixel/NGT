// Bold traditional Japanese patterns (monyō), drawn as small SVG tiles so they cost almost nothing to load.
// Each tour wears one of them like a family crest (see `pattern` in the tour data).

type Tile = { w: number; h: number; svg: (c: string) => string; label: string };

const T: Record<string, Tile> = {
  // Waves: good fortune, calm seas
  seigaiha: { w: 40, h: 20, label: 'Seigaiha (waves)', svg: (c) =>
    `<g fill="none" stroke="${c}" stroke-width="3.4"><path d="M0 20a20 20 0 0 1 40 0M8 20a12 12 0 0 1 24 0M16 20a4 4 0 0 1 8 0M-20 10a20 20 0 0 1 40 0M20 10a20 20 0 0 1 40 0M-12 10a12 12 0 0 1 24 0M28 10a12 12 0 0 1 24 0"/></g>` },
  // Hemp leaf: grows straight and strong (lines from each triangle's corners to its centre)
  asanoha: { w: 30, h: 51.96, label: 'Asanoha (hemp leaf)', svg: (c) => {
    const h = 25.98;
    const tris = [
      [[0, 0], [30, 0], [15, h]], [[-15, h], [15, h], [0, 0]], [[15, h], [45, h], [30, 0]],
      [[0, 2 * h], [30, 2 * h], [15, h]], [[-15, h], [15, h], [0, 2 * h]], [[15, h], [45, h], [30, 2 * h]],
    ];
    const d = tris.map((t) => {
      const cx = (t[0][0] + t[1][0] + t[2][0]) / 3;
      const cy = (t[0][1] + t[1][1] + t[2][1]) / 3;
      return `M${t[0][0]} ${t[0][1]}L${t[1][0]} ${t[1][1]}L${t[2][0]} ${t[2][1]}Z` + t.map((v) => `M${v[0]} ${v[1]}L${cx.toFixed(2)} ${cy.toFixed(2)}`).join('');
    }).join('');
    return `<path fill="none" stroke="${c}" stroke-width="1.8" d="${d}"/>`;
  } },
  // Arrow feathers: once shot, never returns (a sharp choice)
  yagasuri: { w: 24, h: 24, label: 'Yagasuri (arrow feathers)', svg: (c) =>
    `<path fill="${c}" d="M0 0l11 6v12L0 12zM24 12l-11 6v12l11-6zM24 -12l-11 6v12l11-6z"/>` },
  // Tortoise shell: long life (flat-top hexagons with an inner ring)
  kikko: { w: 36, h: 20.78, label: 'Kikko (tortoise shell)', svg: (c) => {
    const r = 12, hh = 10.39;
    const hex = (cx: number, cy: number, k: number) =>
      [[r, 0], [r / 2, hh], [-r / 2, hh], [-r, 0], [-r / 2, -hh], [r / 2, -hh]]
        .map(([x, y], i) => `${i ? 'L' : 'M'}${(cx + x * k).toFixed(2)} ${(cy + y * k).toFixed(2)}`).join('') + 'Z';
    const centres = [[0, 0], [36, 0], [0, 20.78], [36, 20.78], [18, 10.39]];
    return `<g fill="none" stroke="${c}"><path stroke-width="2.6" d="${centres.map(([x, y]) => hex(x, y, 1)).join('')}"/><path stroke-width="1.4" d="${centres.map(([x, y]) => hex(x, y, 0.55)).join('')}"/></g>`;
  } },
  // Scales: protection from evil
  uroko: { w: 32, h: 28, label: 'Uroko (scales)', svg: (c) =>
    `<path fill="${c}" d="M0 14L8 0l8 14zM16 14L24 0l8 14zM8 28l8-14 8 14zM-8 28L0 14l8 14zM24 28l8-14 8 14z"/>` },
  // Seven treasures: circles that link people
  shippo: { w: 32, h: 32, label: 'Shippo (linked circles)', svg: (c) =>
    `<g fill="none" stroke="${c}" stroke-width="2.6"><circle cx="0" cy="0" r="16"/><circle cx="32" cy="0" r="16"/><circle cx="0" cy="32" r="16"/><circle cx="32" cy="32" r="16"/><circle cx="16" cy="16" r="16"/></g>` },
  // Checkerboard
  ichimatsu: { w: 28, h: 28, label: 'Ichimatsu (checks)', svg: (c) =>
    `<path fill="${c}" d="M0 0h14v14H0zM14 14h14v14H14z"/>` },
  // Rising steam: things going up
  tatewaku: { w: 28, h: 40, label: 'Tatewaku (rising steam)', svg: (c) =>
    `<g fill="none" stroke="${c}" stroke-width="3.2"><path d="M4 0c8 10 8 10 0 20s-8 10 0 20M20 0c-8 10-8 10 0 20s8 10 0 20"/></g>` },
};

export const PATTERNS = Object.keys(T) as [string, ...string[]];
export type PatternName = keyof typeof T;

/** CSS background-image value for a pattern in one colour (on a transparent background). */
export function patternBg(name: string | undefined, color = '#f7f0e3', scale = 1): string {
  const t = T[name ?? ''] ?? T.seigaiha;
  const w = t.w * scale;
  const h = t.h * scale;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${t.w} ${t.h}">${t.svg(color)}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export function patternLabel(name: string | undefined): string {
  return (T[name ?? ''] ?? T.seigaiha).label;
}
