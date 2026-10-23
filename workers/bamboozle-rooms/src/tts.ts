import { md5 } from 'js-md5';
import type { Env } from './env';

/**
 * Google Cloud TTS + the existing GCS bucket. The cache key is deliberately
 * unchanged from server/ttsService.js:
 *
 *   md5(`${text}-${language}`).mp3
 *
 * Do not switch to SHA-256: the 3,159 existing MP3s would be orphaned and
 * re-billed.
 */

export interface TtsResult {
  file: string;
  url: string;
  isHit: boolean;
}

export const TTS_CACHE_CONTROL = 'public, max-age=31536000';
const TOKEN_CACHE_KEY = 'google-access-token';
const TOKEN_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const TOKEN_AUDIENCE = 'https://oauth2.googleapis.com/token';
const TOKEN_TTL_SECONDS = 3300;

const VOICE_CONFIG = {
  en: { languageCode: 'en-US', name: 'en-US-Neural2-F', ssmlGender: 'FEMALE' },
  el: { languageCode: 'el-GR', name: 'el-GR-Wavenet-A', ssmlGender: 'FEMALE' },
} as const;

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

interface CachedToken {
  token: string;
  exp: number;
}

let memoryToken: CachedToken | null = null;

export function ttsCacheKey(text: string, language: string): string {
  return md5(`${text}-${language}`);
}

export function ttsObjectName(text: string, language: string): string {
  return `${ttsCacheKey(text, language)}.mp3`;
}

export function ttsPublicUrl(bucket: string, filename: string): string {
  return `https://storage.googleapis.com/${bucket}/${filename}`;
}

export async function getAudio(
  env: Env,
  text: string,
  language: 'en' | 'el',
  roomCode: string,
  beforeGenerate?: () => Promise<void>,
): Promise<TtsResult> {
  if (!text) throw new Error('TEXT_REQUIRED');

  const bucket = env.GCS_BUCKET_NAME || 'bamboozle-audio-assets';
  const filename = ttsObjectName(text, language);
  const publicUrl = ttsPublicUrl(bucket, filename);

  const exists = await gcsObjectExists(env, bucket, filename);
  if (exists) {
    console.log(`[TTS] CACHE HIT room=${roomCode} file=${filename}`);
    return { file: filename, url: publicUrl, isHit: true };
  }

  // The callback consumes the TTS budget. It runs only on a cache miss, so a
  // cache hit never spends the monthly/daily allowance.
  if (beforeGenerate) await beforeGenerate();

  console.log(`[TTS] GENERATE room=${roomCode} file=${filename}`);
  const audio = await synthesize(env, text, language);
  await uploadObject(env, bucket, filename, audio);
  return { file: filename, url: publicUrl, isHit: false };
}

async function gcsObjectExists(env: Env, bucket: string, filename: string): Promise<boolean> {
  const url =
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/` +
    `${encodeURIComponent(filename)}?fields=name`;
  const response = await authorizedFetch(env, url, { method: 'GET' });
  if (response.status === 404) return false;
  if (!response.ok) {
    throw new Error(`GCS_EXISTS_FAILED ${response.status} ${await response.text()}`);
  }
  return true;
}

async function synthesize(env: Env, text: string, language: 'en' | 'el'): Promise<Uint8Array> {
  const voice = VOICE_CONFIG[language] ?? VOICE_CONFIG.en;
  const response = await authorizedFetch(env, 'https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      input: { text },
      voice: {
        languageCode: voice.languageCode,
        name: voice.name,
        ssmlGender: voice.ssmlGender,
      },
      audioConfig: {
        audioEncoding: 'MP3',
        pitch: 0,
        speakingRate: 1.1,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`TTS_SYNTHESIZE_FAILED ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as { audioContent?: string };
  if (!body.audioContent) throw new Error('TTS_EMPTY_AUDIO');
  return base64ToBytes(body.audioContent);
}

async function uploadObject(env: Env, bucket: string, filename: string, audio: Uint8Array): Promise<void> {
  const url =
    `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o` +
    `?uploadType=media&name=${encodeURIComponent(filename)}`;
  const response = await authorizedFetch(env, url, {
    method: 'POST',
    headers: { 'content-type': 'audio/mpeg' },
    body: audio as BodyInit,
  });
  if (!response.ok) {
    throw new Error(`GCS_UPLOAD_FAILED ${response.status} ${await response.text()}`);
  }

  // Keep the one-year cache header the Railway service set. A failed metadata
  // patch must not fail a successful upload.
  const metadataUrl =
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/` +
    `${encodeURIComponent(filename)}?fields=cacheControl`;
  const patch = await authorizedFetch(env, metadataUrl, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cacheControl: TTS_CACHE_CONTROL, contentType: 'audio/mpeg' }),
  });
  if (!patch.ok) console.warn(`[TTS] metadata patch failed ${patch.status}`);
}

async function authorizedFetch(env: Env, url: string, init: RequestInit): Promise<Response> {
  let token = await getAccessToken(env);
  let response = await fetch(url, withBearer(init, token));
  if (response.status === 401) {
    invalidateToken(env);
    token = await getAccessToken(env, true);
    response = await fetch(url, withBearer(init, token));
  }
  return response;
}

function withBearer(init: RequestInit, token: string): RequestInit {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  return { ...init, headers };
}

export function invalidateToken(env: Env): void {
  memoryToken = null;
  void env.TTS_KV.delete(TOKEN_CACHE_KEY).catch(() => undefined);
}

export async function getAccessToken(env: Env, force = false): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (!force && memoryToken && memoryToken.exp > now + 60) return memoryToken.token;

  if (!force) {
    try {
      const cached = await env.TTS_KV.get<CachedToken>(TOKEN_CACHE_KEY, 'json');
      if (cached?.token && cached.exp > now + 60) {
        memoryToken = cached;
        return cached.token;
      }
    } catch {
      // KV is a cache; a read failure must not stop TTS.
    }
  }

  const credentials = parseCredentials(env);
  const token = await mintAccessToken(credentials);
  const exp = now + 3600;
  memoryToken = { token, exp };
  try {
    await env.TTS_KV.put(TOKEN_CACHE_KEY, JSON.stringify({ token, exp }), {
      expirationTtl: TOKEN_TTL_SECONDS,
    });
  } catch {
    // Token remains valid for this isolate even if KV is unavailable.
  }
  return token;
}

function parseCredentials(env: Env): ServiceAccount {
  const raw = env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!raw) throw new Error('TTS_NOT_CONFIGURED');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('TTS_CREDENTIALS_INVALID_JSON');
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as Record<string, unknown>).client_email !== 'string' ||
    typeof (parsed as Record<string, unknown>).private_key !== 'string'
  ) {
    throw new Error('TTS_CREDENTIALS_INVALID');
  }
  return parsed as ServiceAccount;
}

async function mintAccessToken(credentials: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claimSet = base64Url(
    JSON.stringify({
      iss: credentials.client_email,
      scope: TOKEN_SCOPE,
      aud: TOKEN_AUDIENCE,
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${claimSet}`;
  const signature = await signRs256(credentials.private_key, unsigned);
  const assertion = `${unsigned}.${signature}`;

  const response = await fetch(TOKEN_AUDIENCE, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!response.ok) {
    throw new Error(`GOOGLE_TOKEN_FAILED ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) throw new Error('GOOGLE_TOKEN_EMPTY');
  return body.access_token;
}

async function signRs256(privateKeyPem: string, input: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(input),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  return base64ToBytes(base64).buffer as ArrayBuffer;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64Url(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
