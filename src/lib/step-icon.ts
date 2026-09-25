import type { IconName } from '../components/icons';

// Picks an icon for an itinerary step from its words ("Kiriko glass art (15 min)" → cup).
// First match wins, so meeting/farewell come before the place words they often contain.
const RULES: [RegExp, IconName][] = [
  [/\b(meet|meeting|introduction|welcome|briefing)\b/i, 'group'],
  [/\b(farewell|dismissal|wrap-up|goodbye|finish|tips for)\b/i, 'shuriken'],
  [/\b(lgbt\w*|rainbow|nichome|pride)\b/i, 'rainbow'],
  [/\b(scooter|ride)\b/i, 'scooter'],
  [/\b(knife|knives|engrav\w*)\b/i, 'knife'],
  [/\b(kiriko|glass art)\b/i, 'cup'],
  [/\b(ceramic\w*|tableware|bowls?|plates?)\b/i, 'bowl'],
  [/\b(hanko|seal|kanji|stamp)\b/i, 'stamp'],
  [/\b(golden gai|bar|bars|izakaya|drinks?|sake|nightlife)\b/i, 'glass'],
  [/\b(kabukicho|neon|godzilla|city)\b/i, 'city'],
  [/\b(sakura|blossom\w*|garden|gyoen)\b/i, 'sakura'],
  [/\b(sweets|dango|snack\w*|auction|mochi)\b/i, 'dango'],
  [/\b(shutter art|calligraphy|art)\b/i, 'brush'],
  [/\b(photo\w*|camera|shot)\b/i, 'camera'],
  [/\b(shrine|temple|torii|senso-ji|toshogu|omikuji)\b/i, 'torii'],
  [/\b(shop\w*|market|ameyoko|souvenir\w*|local shops)\b/i, 'bag'],
  [/\b(lantern|light-up|lit-up)\b/i, 'lantern'],
  [/\b(street|view|skytree|building|rooftop)\b/i, 'city'],
];

export function stepIcon(label: string): IconName {
  return RULES.find(([re]) => re.test(label))?.[1] ?? 'pin';
}
