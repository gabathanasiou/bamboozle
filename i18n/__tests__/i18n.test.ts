import { describe, expect, it } from 'vitest';
import { getText } from '../index';
import { getNarratorPhrase, getBotNames } from '../narrator';
import { getQuestions } from '../questions';

describe('i18n', () => {
  it('ships a non-trivial question bank in both languages', () => {
    expect(getQuestions('en').length).toBeGreaterThan(50);
    expect(getQuestions('el').length).toBeGreaterThan(50);
    expect(getQuestions('en')[0]).toHaveProperty('fact');
    expect(getQuestions('el')[0]).toHaveProperty('fact');
  });

  it('interpolates translation parameters', () => {
    expect(getText('en', 'LOBBY_ROOM_CODE', { code: 'ABCD' })).toBe('ROOM: ABCD');
    expect(getText('en', 'GAME_ROUND', { current: 1, total: 3 })).toBe('ROUND 1/3');
  });

  it('falls back to the key instead of throwing', () => {
    // @ts-expect-error deliberately unknown key
    expect(getText('en', 'NOT_A_REAL_KEY')).toBe('[NOT_A_REAL_KEY]');
  });

  it('resolves narrator phrases and bot names', () => {
    const phrase = getNarratorPhrase('en', 'JOIN', { name: 'Alex' });
    expect(typeof phrase).toBe('string');
    expect(phrase).not.toContain('{');
    expect(getBotNames('en').length).toBeGreaterThan(0);
    expect(getBotNames('el').length).toBeGreaterThan(0);
    // @ts-expect-error deliberately unknown phrase key
    expect(getNarratorPhrase('en', 'NOT_A_REAL_PHRASE')).toBe('[Missing Text: NOT_A_REAL_PHRASE]');
  });
});
