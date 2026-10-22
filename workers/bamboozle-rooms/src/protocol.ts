/**
 * Native-WebSocket wire protocol. Event names and payloads are the contract in
 * docs/NETWORKING.md; only the transport changed from Socket.IO to one JSON
 * envelope per frame.
 */

export const MAX_FRAME_BYTES = 256 * 1024;
export const ACK_TIMEOUT_MS = 10_000;
export const MAX_NAME_LENGTH = 12;
export const MAX_ANSWER_LENGTH = 100;
export const MAX_TTS_LENGTH = 500;
export const MAX_EVENTS_PER_WINDOW = 20;
export const EVENT_RATE_WINDOW = 10_000;
export const MAX_CONCURRENT_ROOMS_PER_HOST = 2;

export type Role = 'HOST' | 'PLAYER' | 'AUDIENCE';

export interface ClientMessage {
  id?: string;
  event: string;
  data?: unknown;
}

export interface ServerPush {
  event: string;
  data?: unknown;
}

export type ServerAck =
  | { id: string; ok: true; data?: unknown }
  | { id: string; ok: false; error: string };

export interface RateState {
  count: number;
  windowStart: number;
}

export interface SocketAttachment {
  socketId: string;
  roomCode: string | null;
  playerId: string | null;
  role: Role | null;
  isHost: boolean;
  rate: RateState;
}

export type ParseResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; error: 'FRAME_TOO_LARGE' | 'INVALID_ENVELOPE'; id?: string };

const encoder = new TextEncoder();

export function frameBytes(raw: string | ArrayBuffer): number {
  return typeof raw === 'string' ? encoder.encode(raw).byteLength : raw.byteLength;
}

export function parseClientMessage(raw: string | ArrayBuffer): ParseResult {
  if (frameBytes(raw) > MAX_FRAME_BYTES) return { ok: false, error: 'FRAME_TOO_LARGE' };

  let text: string;
  if (typeof raw === 'string') {
    text = raw;
  } else {
    try {
      text = new TextDecoder().decode(raw);
    } catch {
      return { ok: false, error: 'INVALID_ENVELOPE' };
    }
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: 'INVALID_ENVELOPE', id: sniffId(text) };
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'INVALID_ENVELOPE' };
  }

  const record = value as Record<string, unknown>;
  if (typeof record.event !== 'string' || record.event.length === 0 || record.event.length > 64) {
    return { ok: false, error: 'INVALID_ENVELOPE', id: typeof record.id === 'string' ? record.id : undefined };
  }

  return {
    ok: true,
    message: {
      id: typeof record.id === 'string' && record.id.length > 0 && record.id.length <= 128 ? record.id : undefined,
      event: record.event,
      data: record.data,
    },
  };
}

/** Best-effort id extraction so a rejected frame can still be acknowledged. */
function sniffId(text: string): string | undefined {
  const match = text.slice(0, 256).match(/"id"\s*:\s*"([^"]{1,128})"/);
  return match?.[1];
}

export const RATE_LIMITED_EVENTS = new Set([
  'createRoom',
  'joinRoom',
  'gameStateUpdate',
  'hostEvent',
  'requestNarrator',
  'playerEvent',
]);

export function consumeRate(state: RateState, now: number): { limited: boolean; next: RateState } {
  const fresh = now - state.windowStart > EVENT_RATE_WINDOW;
  const next = fresh
    ? { count: 1, windowStart: now }
    : { count: state.count + 1, windowStart: state.windowStart };
  return { limited: next.count > MAX_EVENTS_PER_WINDOW, next };
}

/** Same rules as server/index.js: strip HTML tags, truncate, trim. */
export function sanitize(value: unknown, maxLen = MAX_ANSWER_LENGTH): string {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>?/gm, '').substring(0, maxLen).trim();
}

export function normalizeRoomCode(value: unknown): string | null {
  const code = sanitize(value, 8).toUpperCase();
  return /^[A-Z]{4}$/.test(code) ? code : null;
}

export function normalizeHostId(value: unknown): string {
  return sanitize(value, 50);
}

export function normalizeLanguage(value: unknown): 'en' | 'el' {
  return value === 'el' ? 'el' : 'en';
}

export function normalizeRole(value: unknown): Role {
  if (value === 'HOST' || value === 'PLAYER' || value === 'AUDIENCE') return value;
  return 'PLAYER';
}

/** Sanitises the free-text fields the old server sanitised on playerEvent. */
export function sanitizePlayerEvent(event: unknown): unknown {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return event;
  const copy = structuredClone(event) as Record<string, unknown>;
  const payload = copy.payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    if (typeof record.text === 'string') record.text = sanitize(record.text, MAX_ANSWER_LENGTH);
    if (typeof record.name === 'string') record.name = sanitize(record.name, MAX_NAME_LENGTH);
  }
  return copy;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function safeJson(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}
