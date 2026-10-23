import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

function call(
  path: string,
  init: RequestInit,
  bindings: Record<string, unknown>,
): Promise<Response> {
  return worker.fetch(new Request(`https://worker.test${path}`, init), bindings as never);
}

const post = (headers: Record<string, string> = {}): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: '{}',
});

describe('/api/tts gate', () => {
  it('does not exist when TTS_API_TOKEN is unset', async () => {
    const response = await call('/api/tts', post(), { ...env, TTS_API_TOKEN: '' });
    expect(response.status).toBe(404);
  });

  it('rejects a missing or wrong bearer token', async () => {
    const bindings = { ...env, TTS_API_TOKEN: 'test-token-0123456789' };
    expect((await call('/api/tts', post(), bindings)).status).toBe(401);
    expect(
      (
        await call('/api/tts', post({ authorization: 'Bearer wrong-token-0123456789' }), bindings)
      ).status,
    ).toBe(401);
  });

  it('accepts the configured token before body validation', async () => {
    const response = await call(
      '/api/tts',
      { method: 'POST', headers: { authorization: 'Bearer test-token-0123456789' } },
      { ...env, TTS_API_TOKEN: 'test-token-0123456789' },
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'INVALID_JSON' });
  });
});
