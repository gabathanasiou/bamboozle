import { Question } from '../types';

export type Rng = () => number;

/**
 * Deterministic PRNG (mulberry32). Tests and offline simulations inject this so
 * a run can be replayed exactly; production keeps using Math.random.
 */
export const seededRng = (seed: number): Rng => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const randomIndex = (length: number, rng: Rng): number => {
  if (length <= 0) return -1;
  return Math.min(length - 1, Math.floor(rng() * length));
};

/** Fisher-Yates shuffle over a copy. */
export const shuffle = <T,>(items: readonly T[], rng: Rng = Math.random): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1, rng);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

const unique = <T,>(items: readonly T[]): T[] => [...new Set(items)];

export interface CategoryOptions {
  /** Categories offered this round, in random order. */
  options: string[];
  /** Categories ordered oldest offer first; feed it back on the next round. */
  history: string[];
}

/**
 * Picks categories by least-recently-offered rotation: every unseen category
 * comes first, then the oldest offers. This gives full coverage before any
 * repeat without the awkward short round a fixed-size deck would need.
 */
export const pickCategoryOptions = (params: {
  categories: readonly string[];
  history?: readonly string[];
  lastOptions?: readonly string[];
  count?: number;
  rng?: Rng;
}): CategoryOptions => {
  const { categories, history = [], lastOptions = [], count = 6, rng = Math.random } = params;
  const available = unique(categories);
  if (available.length === 0) return { options: [], history: [] };

  const target = Math.min(count, available.length);
  const valid = new Set(available);

  // Keep each category once, ordered oldest offer -> most recent offer.
  const seen = new Set<string>();
  const recent: string[] = [];
  for (let index = history.length - 1; index >= 0; index--) {
    const category = history[index];
    if (valid.has(category) && !seen.has(category)) {
      seen.add(category);
      recent.unshift(category);
    }
  }

  const fresh = shuffle(available.filter((category) => !seen.has(category)), rng);
  const ordered = [...fresh, ...recent];
  const last = new Set(lastOptions);
  const withoutLast = ordered.filter((category) => !last.has(category));
  const options = (withoutLast.length >= target ? withoutLast : ordered).slice(0, target);

  const chosen = new Set(options);
  const nextHistory = [
    ...recent.filter((category) => !chosen.has(category)),
    ...shuffle(options, rng),
  ];

  return { options: shuffle(options, rng), history: nextHistory };
};

export interface QuestionPick {
  question: Question | null;
  usedQuestionIds: string[];
}

/**
 * Picks an unused question from the chosen category. A category resets only
 * after all of its own questions have been used, and the reset avoids the
 * question played immediately before.
 */
export const pickQuestion = (params: {
  questions: readonly Question[];
  usedQuestionIds?: readonly string[];
  category: string;
  avoidId?: string;
  rng?: Rng;
}): QuestionPick => {
  const {
    questions,
    usedQuestionIds = [],
    category,
    avoidId,
    rng = Math.random,
  } = params;
  const categoryPool = questions.filter((question) => question.category === category);
  if (categoryPool.length === 0) {
    return { question: null, usedQuestionIds: [...usedQuestionIds] };
  }

  const categoryIds = new Set(categoryPool.map((question) => question.id));
  const validIds = new Set(questions.map((question) => question.id));
  const used = new Set(usedQuestionIds);
  let available = categoryPool.filter((question) => !used.has(question.id));
  let nextUsed = unique(usedQuestionIds).filter((id) => validIds.has(id));

  if (available.length === 0) {
    // Only this category's bag empties; the rest of the bank stays intact.
    nextUsed = nextUsed.filter((id) => !categoryIds.has(id));
    available = categoryPool;
  }

  if (available.length > 1 && avoidId) {
    const withoutLast = available.filter((question) => question.id !== avoidId);
    if (withoutLast.length > 0) available = withoutLast;
  }

  const question = available.length > 0
    ? available[randomIndex(available.length, rng)]
    : null;
  if (question && !nextUsed.includes(question.id)) nextUsed.push(question.id);
  return { question, usedQuestionIds: nextUsed };
};

/** Drops unknown and duplicate IDs coming from old or corrupt localStorage. */
export const sanitizeUsedQuestionIds = (
  questions: readonly Question[],
  usedQuestionIds: readonly string[],
): string[] => {
  const valid = new Set(questions.map((question) => question.id));
  return unique(usedQuestionIds).filter((id) => valid.has(id));
};
