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
export const HOST_SECRET_BYTES = 16;

export type Role = 'HOST' | 'PLAYER' | 'AUDIENCE';

/**
 * The only `playerEvent` types an unprivileged socket may send to the host
 * reducer. Host-only actions stay on the `hostEvent` channel.
 */
export const PLAYER_EVENT_TYPES = new Set([
  'JOIN_ROOM',
  'JOIN_AUDIENCE',
  'TOGGLE_READY',
  'SUBMIT_LIE',
  'SUBMIT_VOTE',
  'SUBMIT_AUDIENCE_VOTE',
  'SELECT_CATEGORY',
  'SEND_EMOTE',
]);

/** Events whose payload carries the sender's player id and must be stamped. */
const SENDER_ID_EVENTS = new Set([
  'TOGGLE_READY',
  'SUBMIT_LIE',
  'SUBMIT_VOTE',
  'SUBMIT_AUDIENCE_VOTE',
  'SELECT_CATEGORY',
]);

const PLAYER_ID_RE = /^[A-Za-z0-9_-]{1,50}$/;
const HOST_SECRET_RE = /^[A-Za-z0-9_-]{16,128}$/;
const RESERVED_PLAYER_IDS = new Set(['__proto__', 'constructor', 'prototype']);

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
  clientIp: string;
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
  'checkRoom',
  'getRoomsByHost',
  'requestState',
  'gameStateUpdate',
  'hostEvent',
  'requestNarrator',
  'playerEvent',
]);

/** Read-only lookups also get a per-IP budget, not just a per-socket one. */
export const READ_EVENTS = new Set(['checkRoom', 'getRoomsByHost', 'requestState']);

export function consumeRate(
  state: RateState,
  now: number,
  limit = MAX_EVENTS_PER_WINDOW,
  windowMs = EVENT_RATE_WINDOW,
): { limited: boolean; next: RateState } {
  const fresh = now - state.windowStart > windowMs;
  const next = fresh
    ? { count: 1, windowStart: now }
    : { count: state.count + 1, windowStart: state.windowStart };
  return { limited: next.count > limit, next };
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
  return validatePlayerId(value);
}

export function validatePlayerId(value: unknown): string {
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  if (raw.length > 50) return '';
  const id = sanitize(raw, 50);
  if (!id || RESERVED_PLAYER_IDS.has(id) || !PLAYER_ID_RE.test(id)) return '';
  return id;
}

export function normalizeHostSecret(value: unknown): string {
  if (typeof value !== 'string') return '';
  const secret = value.trim();
  return HOST_SECRET_RE.test(secret) ? secret : '';
}

export function randomHostSecret(): string {
  const bytes = new Uint8Array(HOST_SECRET_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashHostSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Compare two secrets/hashes without an early exit on the first mismatch. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isPlayerEventType(value: unknown): boolean {
  return typeof value === 'string' && PLAYER_EVENT_TYPES.has(value);
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
    if (typeof record.senderName === 'string') record.senderName = sanitize(record.senderName, MAX_NAME_LENGTH);
    if (typeof record.senderSeed === 'string') record.senderSeed = sanitize(record.senderSeed, MAX_NAME_LENGTH);
  }
  return copy;
}

/**
 * Reject host-only event types and overwrite the sender-controlled ids with
 * the id attached to the socket. Returns null when the event is not allowed.
 */
export function stampPlayerEvent(event: unknown, senderId: string): unknown | null {
  if (!senderId || !event || typeof event !== 'object' || Array.isArray(event)) return null;
  const record = event as Record<string, unknown>;
  if (!isPlayerEventType(record.type)) return null;

  const copy = structuredClone(event) as Record<string, unknown>;
  const payload =
    copy.payload && typeof copy.payload === 'object' && !Array.isArray(copy.payload)
      ? (copy.payload as Record<string, unknown>)
      : {};
  if (SENDER_ID_EVENTS.has(copy.type as string)) payload.playerId = senderId;
  if (copy.type === 'JOIN_ROOM' || copy.type === 'JOIN_AUDIENCE') payload.id = senderId;
  copy.payload = payload;
  return sanitizePlayerEvent(copy);
}

/** requestState is only allowed for the room the socket actually joined. */
export function canReadRoomState(attachmentRoomCode: string | null, requestedCode: string | null): boolean {
  return !!attachmentRoomCode && (!requestedCode || requestedCode === attachmentRoomCode);
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
