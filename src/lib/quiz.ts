// "What are you into?" answers for the home page quiz (NinjaQuiz.astro).
// Each tour says which of these it is really about (quizFor) and which it also touches on (quizAlso).
// The quiz only offers answers that are the main thing of a tour that still fits, and only recommends
// a tour whose main thing matches the answer.
import type { IconName } from '../components/icons';

export const INTERESTS = [
  { v: 'shrines', icon: 'torii', label: 'Hidden shrines' },
  { v: 'nightlife', icon: 'glass', label: 'Tiny bars & nightlife' },
  { v: 'food', icon: 'dango', label: 'Street food & snacks' },
  { v: 'craft', icon: 'stamp', label: 'Make your own souvenir' },
  { v: 'shopping', icon: 'knife', label: 'Knives & kitchenware' },
  { v: 'photos', icon: 'camera', label: 'Night photo spots' },
  { v: 'lgbtq', icon: 'rainbow', label: 'LGBTQ+ culture' },
  { v: 'sakura', icon: 'sakura', label: 'Cherry blossoms' },
  { v: 'ride', icon: 'scooter', label: 'Riding an e-scooter' },
] as const satisfies readonly { v: string; icon: IconName; label: string }[];

export type Interest = (typeof INTERESTS)[number]['v'];
export const INTEREST_IDS = INTERESTS.map((i) => i.v) as [Interest, ...Interest[]];
