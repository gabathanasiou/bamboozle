import { describe, expect, it } from 'vitest';
import { loadQuestions } from '../i18n/questions';
import { Question } from '../types';
import {
  pickCategoryOptions,
  pickQuestion,
  sanitizeUsedQuestionIds,
  seededRng,
  shuffle,
} from './questionPicker';

const makeQuestion = (id: string, category: string): Question => ({
  id,
  fact: `fact ${id}`,
  answer: `answer ${id}`,
  category,
  lies: [],
});

const pool = [
  makeQuestion('a1', 'A'),
  makeQuestion('a2', 'A'),
  makeQuestion('a3', 'A'),
  makeQuestion('b1', 'B'),
];

describe('random primitives', () => {
  it('replays the same sequence for the same seed', () => {
    const first = seededRng(7);
    const second = seededRng(7);
    expect(Array.from({ length: 8 }, () => first())).toEqual(
      Array.from({ length: 8 }, () => second()),
    );
  });

  it('shuffles without losing or inventing items', () => {
    const items = Array.from({ length: 20 }, (_, index) => index);
    const shuffled = shuffle(items, seededRng(1));
    expect(shuffled).toHaveLength(items.length);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
  });
});

describe('category rotation', () => {
  const categories = Array.from({ length: 28 }, (_, index) => `c${index}`);
  const count = 6;

  it('offers every category once before repeating, never twice in a row', () => {
    const rng = seededRng(1234);
    let history: string[] = [];
    let lastOptions: string[] = [];
    const seen = new Set<string>();

    for (let round = 0; round < 5; round++) {
      const pick = pickCategoryOptions({ categories, history, lastOptions, count, rng });
      expect(pick.options).toHaveLength(count);
      expect(new Set(pick.options).size).toBe(count);

      for (const option of pick.options) {
        expect(lastOptions).not.toContain(option);
        seen.add(option);
      }

      history = pick.history;
      lastOptions = pick.options;
    }

    expect(seen.size).toBe(categories.length);
  });

  it('covers every category in any five-round window', () => {
    const rng = seededRng(99);
    let history: string[] = [];
    let lastOptions: string[] = [];
    const window: string[][] = [];

    for (let round = 0; round < 15; round++) {
      const pick = pickCategoryOptions({ categories, history, lastOptions, count, rng });
      history = pick.history;
      lastOptions = pick.options;
      window.push(pick.options);
      if (window.length > 5) window.shift();

      if (round >= 4) {
        expect(new Set(window.flat()).size).toBe(categories.length);
      }
    }
  });

  it('spreads offers evenly over many cycles', () => {
    const rng = seededRng(2026);
    let history: string[] = [];
    let lastOptions: string[] = [];
    const counts = new Map(categories.map((category) => [category, 0]));
    const rounds = 2800;

    for (let round = 0; round < rounds; round++) {
      const pick = pickCategoryOptions({ categories, history, lastOptions, count, rng });
      pick.options.forEach((option) => counts.set(option, counts.get(option)! + 1));
      history = pick.history;
      lastOptions = pick.options;
    }

    const mean = (rounds * count) / categories.length;
    for (const value of counts.values()) {
      expect(value).toBeGreaterThan(mean * 0.9);
      expect(value).toBeLessThan(mean * 1.1);
    }
  });

  it('returns every category once when there are fewer categories than slots', () => {
    const pick = pickCategoryOptions({
      categories: ['A', 'B', 'C'],
      count: 6,
      rng: seededRng(3),
    });
    expect([...pick.options].sort()).toEqual(['A', 'B', 'C']);
    expect([...pick.history].sort()).toEqual(['A', 'B', 'C']);
  });

  it('ignores corrupt history entries and last round options', () => {
    const pick = pickCategoryOptions({
      categories: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
      history: ['F', 'F', 'nope', 'A'],
      lastOptions: ['A'],
      count: 6,
      rng: seededRng(4),
    });
    expect(pick.options).toHaveLength(6);
    expect(new Set(pick.options).size).toBe(6);
    expect(pick.options).toContain('F');
    expect(pick.options).not.toContain('A');
  });
});

describe('question bags', () => {
  it('never repeats a question until its category is exhausted', () => {
    const rng = seededRng(5);
    let used: string[] = [];
    const drawn: string[] = [];

    for (let round = 0; round < 3; round++) {
      const pick = pickQuestion({ questions: pool, usedQuestionIds: used, category: 'A', rng });
      expect(pick.question).not.toBeNull();
      used = pick.usedQuestionIds;
      drawn.push(pick.question!.id);
    }

    expect(new Set(drawn).size).toBe(3);
    expect(used).toEqual(expect.arrayContaining(drawn));
  });

  it('resets only the exhausted category and avoids the previous question', () => {
    const pick = pickQuestion({
      questions: pool,
      usedQuestionIds: ['a1', 'a2', 'a3', 'b1'],
      category: 'A',
      avoidId: 'a3',
      rng: seededRng(8),
    });

    expect(pick.question).not.toBeNull();
    expect(pick.question!.id).not.toBe('a3');
    expect(pick.question!.category).toBe('A');
    expect(pick.usedQuestionIds).toContain('b1');
    expect(pick.usedQuestionIds.filter((id) => id.startsWith('a'))).toEqual([
      pick.question!.id,
    ]);
  });

  it('draws each question roughly equally across repeated cycles', () => {
    const rng = seededRng(77);
    const counts = new Map(['a1', 'a2', 'a3'].map((id) => [id, 0]));
    let used: string[] = [];
    let last: string | undefined;

    for (let round = 0; round < 6000; round++) {
      const pick = pickQuestion({
        questions: pool,
        usedQuestionIds: used,
        category: 'A',
        avoidId: last,
        rng,
      });
      used = pick.usedQuestionIds;
      last = pick.question!.id;
      counts.set(last, counts.get(last)! + 1);
    }

    for (const value of counts.values()) {
      expect(value).toBeGreaterThan(1800);
      expect(value).toBeLessThan(2200);
    }
  });

  it('drops unknown and duplicate persisted ids', () => {
    expect(sanitizeUsedQuestionIds(pool, ['a1', 'a1', 'nope', 'b1'])).toEqual(['a1', 'b1']);
  });
});

describe('question bank integrity', () => {
  it.each(['en', 'el'] as const)('%s ships unique facts and unique ids', (language) => {
    const questions = loadQuestions(language);
    expect(questions.length).toBeGreaterThan(50);
    expect(new Set(questions.map((question) => question.fact)).size).toBe(questions.length);
    expect(new Set(questions.map((question) => question.id)).size).toBe(questions.length);
  });

  it.each(['en', 'el'] as const)('%s has one canonical Law category', (language) => {
    const categories = new Set(loadQuestions(language).map((question) => question.category));
    expect(categories.has('Law')).toBe(false);
    expect(categories.has('Laws')).toBe(true);
  });

  it.each(['en', 'el'] as const)('%s plays a whole bank cycle without repeating', (language) => {
    const questions = loadQuestions(language);
    const rng = seededRng(31);
    let used: string[] = [];
    let history: string[] = [];
    let lastOptions: string[] = [];
    let lastQuestion: string | undefined;
    const played = new Set<string>();

    for (let round = 0; round < questions.length; round++) {
      const available = questions.filter((question) => !used.includes(question.id));
      expect(available.length).toBeGreaterThan(0);

      const { options, history: nextHistory } = pickCategoryOptions({
        categories: [...new Set(available.map((question) => question.category))],
        history,
        lastOptions,
        rng,
      });
      history = nextHistory;
      lastOptions = options;

      const category = options[Math.floor(rng() * options.length)];
      const pick = pickQuestion({
        questions,
        usedQuestionIds: used,
        category,
        avoidId: lastQuestion,
        rng,
      });
      expect(pick.question).not.toBeNull();
      used = pick.usedQuestionIds;
      lastQuestion = pick.question!.id;

      expect(played.has(lastQuestion)).toBe(false);
      played.add(lastQuestion);
    }

    expect(played.size).toBe(questions.length);
  });
});
