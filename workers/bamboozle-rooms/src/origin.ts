import type { Env } from './env';

/**
 * CORS/WS origin allow-list. Deploy previews use
 * https://<deploy-id>--bamboozlegame.netlify.app, hence the wildcard pattern.
 * Never use "*" in production.
 */
const DEFAULT_PATTERNS = [
  'https://bamboozlegame.netlify.app',
  'https://*--bamboozlegame.netlify.app',
  'http://localhost:*',
  'http://127.0.0.1:*',
  'capacitor://localhost',
  'https://localhost',
  'http://localhost',
];

export function isOriginAllowed(origin: string | null, env: Env): boolean {
  // Native WebSocket clients (Capacitor/Android) may not send Origin.
  if (!origin) return true;
  const configured = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return (configured.length ? configured : DEFAULT_PATTERNS).some((pattern) => match(pattern, origin));
}

function match(pattern: string, value: string): boolean {
  if (pattern === '*') return true;
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(value);
}

export function corsHeaders(origin: string | null): Headers {
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  });
  if (origin) headers.set('Access-Control-Allow-Origin', origin);
  return headers;
}
