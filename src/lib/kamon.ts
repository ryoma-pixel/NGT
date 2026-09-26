// Family crests (kamon) drawn for NINJA GO TOURS: one per tour, in the classic "maru ni ~" (motif in a ring) style.
// All shapes sit in a 100 x 100 box and use `currentColor`, so the crest takes the colour of its container.

const ring = '<circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="6"/>';

const petal = 'M50 50 C 38 40, 36 24, 44 14 L 50 20 L 56 14 C 64 24, 62 40, 50 50 Z';
const spoke = (a: number) => `<rect x="48" y="12" width="4" height="30" transform="rotate(${a} 50 50)"/>`;

export const KAMON: Record<string, { label: string; svg: string }> = {
  // Torii gate: the hidden shrine
  torii: { label: 'Torii gate', svg: `${ring}<g fill="currentColor">
    <path d="M18 30 Q 50 24 82 30 L 82 37 Q 50 31 18 37 Z"/>
    <rect x="24" y="42" width="52" height="5"/>
    <rect x="31" y="33" width="6" height="45"/><rect x="63" y="33" width="6" height="45"/>
    <rect x="47" y="36" width="6" height="7"/></g>` },
  // Noren curtain: the doors of tiny bars
  noren: { label: 'Noren curtain', svg: `${ring}<g fill="currentColor">
    <rect x="22" y="26" width="56" height="6" rx="2"/>
    <path d="M24 34 H 39 V 70 L 31.5 64 L 24 70 Z"/><path d="M42.5 34 H 57.5 V 74 L 50 68 L 42.5 74 Z"/><path d="M61 34 H 76 V 70 L 68.5 64 L 61 70 Z"/></g>` },
  // Seal: your name in kanji
  seal: { label: 'Hanko seal', svg: `${ring}<g fill="currentColor">
    <circle cx="50" cy="26" r="8"/><path d="M44 32 H 56 L 60 46 H 40 Z"/><rect x="33" y="48" width="34" height="20" rx="3"/>
    <rect x="26" y="72" width="48" height="5" rx="2"/></g>` },
  // Crossed knives (chigai-bōchō): Kappabashi
  knives: { label: 'Crossed knives', svg: `${ring}<g fill="currentColor">${[-34, 34].map((a) => `<g transform="rotate(${a} 50 50)">
    <path d="M43 60 V 24 C 43 16, 49 12, 57 12 V 60 Z"/><rect x="42" y="61" width="16" height="4"/><rect x="45" y="66" width="10" height="22" rx="3"/></g>`).join('')}</g>` },
  // Hemp leaf star: Ueno
  asanoha: { label: 'Hemp leaf', svg: `${ring}<path fill="none" stroke="currentColor" stroke-width="3.2" stroke-linejoin="round" d="M50.0 19.0 L76.8 34.5 L76.8 65.5 L50.0 81.0 L23.2 65.5 L23.2 34.5 Z M50 50 L50.0 19.0 M50.0 19.0 L58.9 34.5 M76.8 34.5 L58.9 34.5 M50 50 L58.9 34.5 M50 50 L76.8 34.5 M76.8 34.5 L67.9 50.0 M76.8 65.5 L67.9 50.0 M50 50 L67.9 50.0 M50 50 L76.8 65.5 M76.8 65.5 L58.9 65.5 M50.0 81.0 L58.9 65.5 M50 50 L58.9 65.5 M50 50 L50.0 81.0 M50.0 81.0 L41.1 65.5 M23.2 65.5 L41.1 65.5 M50 50 L41.1 65.5 M50 50 L23.2 65.5 M23.2 65.5 L32.1 50.0 M23.2 34.5 L32.1 50.0 M50 50 L32.1 50.0 M50 50 L23.2 34.5 M23.2 34.5 L41.1 34.5 M50.0 19.0 L41.1 34.5 M50 50 L41.1 34.5"/>` },
  // Three bands (mitsu-biki) bent into a rainbow: Nichome
  rainbow: { label: 'Rainbow bands', svg: `${ring}<g fill="none" stroke="currentColor" stroke-width="6">
    <path d="M20 66 A 30 30 0 0 1 80 66"/><path d="M30 66 A 20 20 0 0 1 70 66"/><path d="M40 66 A 10 10 0 0 1 60 66"/></g>
    <rect x="16" y="68" width="68" height="6" fill="currentColor"/>` },
  // Cherry blossom (sakura): Shinjuku Gyoen
  sakura: { label: 'Cherry blossom', svg: `${ring}<g fill="currentColor">${[0, 72, 144, 216, 288].map((a) => `<path d="${petal}" transform="rotate(${a} 50 50)"/>`).join('')}</g>
    <circle cx="50" cy="50" r="6" fill="var(--kamon-bg, #1f2d52)"/>` },
  // Carriage wheel (Genji-guruma): E-scooter
  wheel: { label: 'Carriage wheel', svg: `${ring}<circle cx="50" cy="50" r="34" fill="none" stroke="currentColor" stroke-width="5"/>
    <g fill="currentColor">${[0, 45, 90, 135, 180, 225, 270, 315].map(spoke).join('')}</g>
    <circle cx="50" cy="50" r="11" fill="currentColor"/><circle cx="50" cy="50" r="4" fill="var(--kamon-bg, #1f2d52)"/>` },
  // Paper lantern: Asakusa nights
  lantern: { label: 'Paper lantern', svg: `${ring}<g fill="currentColor">
    <rect x="38" y="20" width="24" height="7" rx="1.5"/><rect x="38" y="73" width="24" height="7" rx="1.5"/>
    <path d="M36 28 H 64 C 76 36, 76 64, 64 72 H 36 C 24 64, 24 36, 36 28 Z"/></g>
    <g fill="none" stroke="var(--kamon-bg, #1f2d52)" stroke-width="3"><path d="M29 40 H 71 M 27 50 H 73 M 29 60 H 71"/></g>` },
  // Dango on a skewer: Asakusa street snacks
  dango: { label: 'Dango skewer', svg: `${ring}<g fill="currentColor" transform="rotate(-35 50 50)">
    <rect x="48" y="14" width="4" height="74" rx="2"/>
    <circle cx="50" cy="28" r="11"/><circle cx="50" cy="50" r="11"/><circle cx="50" cy="72" r="11"/></g>` },
  // Beckoning cat's face: Imado Shrine, home of the maneki-neko
  cat: { label: 'Lucky cat', svg: `${ring}<g fill="currentColor">
    <path d="M27 50 L31 22 L46 36 Z"/><path d="M73 50 L69 22 L54 36 Z"/>
    <ellipse cx="50" cy="55" rx="25" ry="22"/></g>
    <g fill="none" stroke="var(--kamon-bg, #1f2d52)" stroke-width="3.2" stroke-linecap="round">
    <path d="M38 52 Q 42 48 46 52"/><path d="M54 52 Q 58 48 62 52"/><path d="M46 62 Q 50 66 54 62"/>
    <path d="M24 60 H 36 M 64 60 H 76"/></g>` },
  // Taiko drum with its sticks: Edo crafts and drums
  drum: { label: 'Taiko drum', svg: `${ring}<g fill="currentColor">
    <path d="M30 38 C 24 48, 24 62, 30 72 H 70 C 76 62, 76 48, 70 38 Z"/><ellipse cx="50" cy="38" rx="20" ry="6"/>
    <rect x="24" y="20" width="5" height="26" rx="2.5" transform="rotate(-38 26 33)"/><rect x="71" y="20" width="5" height="26" rx="2.5" transform="rotate(38 74 33)"/></g>
    <g fill="var(--kamon-bg, #1f2d52)"><circle cx="32" cy="47" r="1.8"/><circle cx="32" cy="66" r="1.8"/><circle cx="39" cy="47" r="1.8"/><circle cx="39" cy="66" r="1.8"/><circle cx="46" cy="47" r="1.8"/><circle cx="46" cy="66" r="1.8"/><circle cx="54" cy="47" r="1.8"/><circle cx="54" cy="66" r="1.8"/><circle cx="61" cy="47" r="1.8"/><circle cx="61" cy="66" r="1.8"/><circle cx="68" cy="47" r="1.8"/><circle cx="68" cy="66" r="1.8"/></g>` },
};

export const KAMON_NAMES = Object.keys(KAMON) as [string, ...string[]];
