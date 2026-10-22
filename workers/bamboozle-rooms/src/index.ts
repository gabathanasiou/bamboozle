import type { Env } from './env';
import { corsHeaders, isOriginAllowed } from './origin';
import { sanitize } from './protocol';
import { getAudio } from './tts';

export { BambooRoom } from './room';
export { Directory } from './directory';

const WORKER_VERSION = '0.1.0';
const MAX_TTS_BODY_BYTES = 16 * 1024;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');

    if (url.pathname.startsWith('/internal/')) {
      return new Response('Not found', { status: 404 });
    }

    if (!isOriginAllowed(origin, env)) {
      return withCors(new Response('Origin not allowed', { status: 403 }), origin);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    try {
      if (url.pathname === '/ws') return await websocket(request, env, origin);
      if (url.pathname === '/health' && request.method === 'GET') {
        return withCors(
          json({ ok: true, service: 'bamboozle-rooms', version: WORKER_VERSION, now: Date.now() }),
          origin,
        );
      }
      if (url.pathname === '/api/version' && request.method === 'GET') {
        return withCors(json({ version: WORKER_VERSION }), origin);
      }
      if (url.pathname === '/api/tts' && request.method === 'POST') {
        return withCors(await tts(request, env), origin);
      }
      if (url.pathname === '/' && request.method === 'GET') {
        return withCors(new Response('Bamboozle rooms is running'), origin);
      }
      return withCors(json({ error: 'NOT_FOUND' }, 404), origin);
    } catch (error) {
      console.error('[Worker] unhandled error', error);
      return withCors(json({ error: 'INTERNAL_ERROR' }, 500), origin);
    }
  },
};

async function websocket(request: Request, env: Env, origin: string | null): Promise<Response> {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 426 });
  }

  const id = env.DIRECTORY.idFromName('directory');
  const stub = env.DIRECTORY.get(id);
  const response = await stub.fetch(request);

  // 101 responses cannot carry normal CORS headers; browsers do not require
  // them for WebSockets. The Origin allow-list above is the gate.
  return response;
}

async function tts(request: Request, env: Env): Promise<Response> {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_TTS_BODY_BYTES) return json({ error: 'BODY_TOO_LARGE' }, 413);

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return json({ error: 'INVALID_JSON' }, 400);
  }

  const text = sanitize(body.text, 500);
  if (!text) return json({ error: 'TEXT_REQUIRED' }, 400);
  const language = body.language === 'el' ? 'el' : 'en';
  const roomCode = sanitize(body.roomCode, 8) || 'api';

  try {
    const result = await getAudio(env, text, language, roomCode);
    return json({ url: result.url, isHit: result.isHit });
  } catch (error) {
    console.error('[Worker] /api/tts failed', error);
    return json({ error: error instanceof Error ? error.message : 'TTS_FAILED' }, 500);
  }
}

function withCors(response: Response, origin: string | null): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of corsHeaders(origin)) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
