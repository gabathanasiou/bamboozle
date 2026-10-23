import { describe, expect, it } from 'vitest';
import {
  MAX_ANSWER_LENGTH,
  MAX_EVENTS_PER_WINDOW,
  MAX_FRAME_BYTES,
  canReadRoomState,
  consumeRate,
  hashSecret,
  normalizeSecret,
  normalizeRoomCode,
  parseClientMessage,
  sanitize,
  sanitizePlayerEvent,
  stampPlayerEvent,
  validatePlayerId,
} from '../src/protocol';
import { ttsCacheKey, ttsObjectName, ttsPublicUrl } from '../src/tts';

describe('protocol validation', () => {
  it('parses one JSON envelope', () => {
    const parsed = parseClientMessage(JSON.stringify({ id: 'a1', event: 'checkRoom', data: { roomCode: 'ABCD' } }));
    expect(parsed).toEqual({
      ok: true,
      message: { id: 'a1', event: 'checkRoom', data: { roomCode: 'ABCD' } },
    });
  });

  it('rejects malformed JSON but keeps a sniffable id', () => {
    expect(parseClientMessage('{"id":"r1","event":')).toEqual({
      ok: false,
      error: 'INVALID_ENVELOPE',
      id: 'r1',
    });
  });

  it('rejects a missing or non-string event', () => {
    expect(parseClientMessage('{"id":"r1"}')).toMatchObject({ ok: false, error: 'INVALID_ENVELOPE' });
    expect(parseClientMessage('{"id":"r1","event":42}')).toMatchObject({ ok: false, error: 'INVALID_ENVELOPE' });
  });

  it('rejects frames above 256 KiB before parsing', () => {
    const huge = 'x'.repeat(MAX_FRAME_BYTES + 1);
    expect(parseClientMessage(huge)).toEqual({ ok: false, error: 'FRAME_TOO_LARGE' });
  });

  it('accepts array buffers', () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ event: 'checkRoom' })).buffer;
    expect(parseClientMessage(bytes)).toMatchObject({ ok: true });
  });
});

describe('sanitize', () => {
  it('strips tags, truncates and trims exactly like server/index.js', () => {
    expect(sanitize('  <b>Hello</b> <script>x</script>  ', 20)).toBe('Hello x');
    expect(sanitize(42)).toBe('');
    expect(sanitize('x'.repeat(200))).toHaveLength(MAX_ANSWER_LENGTH);
  });

  it('sanitises playerEvent text and name only', () => {
    const event = {
      type: 'SUBMIT_LIE',
      payload: { text: '  <i>a lie</i>  ', name: '<b>Bob</b>', id: '<keep>' },
    };
    expect(sanitizePlayerEvent(event)).toEqual({
      type: 'SUBMIT_LIE',
      payload: { text: 'a lie', name: 'Bob', id: '<keep>' },
    });
  });

  it('normalises a 4-letter room code', () => {
    expect(normalizeRoomCode(' abcd ')).toBe('ABCD');
    expect(normalizeRoomCode('ABC')).toBeNull();
    expect(normalizeRoomCode('AB1D')).toBeNull();
    expect(normalizeRoomCode(null)).toBeNull();
  });
});

describe('identity and player-event authorization', () => {
  it('accepts generated ids and rejects prototype keys', () => {
    expect(validatePlayerId('Abc_123-xyz')).toBe('Abc_123-xyz');
    for (const id of ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', 'has space', '', 'x'.repeat(51)]) {
      expect(validatePlayerId(id)).toBe('');
    }
  });

  it('only accepts well-formed host secrets', () => {
    expect(normalizeSecret('0123456789abcdef0123456789abcdef')).toBe(
      '0123456789abcdef0123456789abcdef',
    );
    expect(normalizeSecret('short')).toBe('');
    expect(normalizeSecret(null)).toBe('');
  });

  it('hashes the host secret with SHA-256', async () => {
    await expect(hashSecret('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('drops host-only event types', () => {
    for (const type of ['START_GAME', 'RESTART_GAME', 'REMOVE_PLAYER', 'UPDATE_ROUNDS']) {
      expect(stampPlayerEvent({ type, payload: {} }, 'player-1')).toBeNull();
    }
  });

  it('stamps the sender id over forged ids and sanitises text', () => {
    expect(
      stampPlayerEvent(
        { type: 'SUBMIT_VOTE', payload: { playerId: 'victim', answerId: 'a1' } },
        'player-1',
      ),
    ).toEqual({ type: 'SUBMIT_VOTE', payload: { playerId: 'player-1', answerId: 'a1' } });

    expect(
      stampPlayerEvent(
        { type: 'JOIN_ROOM', payload: { id: 'victim', name: '<b>Bob</b>' } },
        'player-1',
      ),
    ).toEqual({ type: 'JOIN_ROOM', payload: { id: 'player-1', name: 'Bob' } });

    expect(
      stampPlayerEvent(
        {
          type: 'JOIN_ROOM',
          payload: { id: 'victim', avatarSeed: 'x'.repeat(100), isBot: true },
        },
        'player-1',
      ),
    ).toEqual({ type: 'JOIN_ROOM', payload: { id: 'player-1', avatarSeed: 'x'.repeat(12) } });

    expect(stampPlayerEvent({ type: 'SEND_EMOTE', payload: { type: 'HACK' } }, 'player-1')).toBeNull();

    expect(
      stampPlayerEvent(
        { type: 'SELECT_CATEGORY', payload: { category: 'Film', playerId: 'victim' } },
        'player-1',
      ),
    ).toEqual({ type: 'SELECT_CATEGORY', payload: { category: 'Film', playerId: 'player-1' } });
  });

  it('only reads the room the socket joined', () => {
    expect(canReadRoomState('ABCD', 'ABCD')).toBe(true);
    expect(canReadRoomState('ABCD', null)).toBe(true);
    expect(canReadRoomState('ABCD', 'WXYZ')).toBe(false);
    expect(canReadRoomState(null, 'ABCD')).toBe(false);
  });
});

describe('rate limit', () => {
  it('allows 20 events per 10s and drops the 21st', () => {
    let state = { count: 0, windowStart: 1_000 };
    for (let i = 0; i < MAX_EVENTS_PER_WINDOW; i++) {
      const result = consumeRate(state, 1_000 + i);
      expect(result.limited).toBe(false);
      state = result.next;
    }
    expect(consumeRate(state, 2_000).limited).toBe(true);
  });

  it('resets after the window', () => {
    const result = consumeRate({ count: MAX_EVENTS_PER_WINDOW, windowStart: 0 }, 10_001);
    expect(result).toEqual({ limited: false, next: { count: 1, windowStart: 10_001 } });
  });
});

describe('TTS cache key', () => {
  it('is md5(text + "-" + language), not SHA-256', () => {
    expect(ttsCacheKey('Hello', 'en')).toBe('00b15ca2c9f8261f48be553f942420ea');
    expect(ttsCacheKey('The quick brown fox', 'en')).toBe('fb0bb3c74bc65f30cb9bf2fb9b62dc55');
    expect(ttsCacheKey('', 'en')).toBe('f75c6c00ebb523120ff2b88dcd1869b7');
  });

  it('keeps the existing .mp3 object name and public URL shape', () => {
    const name = ttsObjectName('Hello', 'en');
    expect(name).toBe('00b15ca2c9f8261f48be553f942420ea.mp3');
    expect(ttsPublicUrl('bamboozle-audio-assets', name)).toBe(
      'https://storage.googleapis.com/bamboozle-audio-assets/00b15ca2c9f8261f48be553f942420ea.mp3',
    );
  });
});
