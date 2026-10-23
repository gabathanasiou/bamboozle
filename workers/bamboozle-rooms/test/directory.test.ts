import { env, runInDurableObject } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Directory } from '../src/directory';

const HOST = 'host-directory';
const directory = () => env.DIRECTORY.get(env.DIRECTORY.idFromName('directory'));

async function create(
  hostId = HOST,
  socketId = 'host-sock',
  secret?: string,
  createKey?: string,
): Promise<{ roomCode: string; hostSecret: string }> {
  return runInDurableObject(directory(), async (instance: Directory) =>
    instance.createRoomForHost(hostId, socketId, secret, createKey),
  );
}

async function roomRows() {
  return runInDurableObject(directory(), (_instance: Directory, state) =>
    state.storage.sql
      .exec('SELECT code, host_id, host_secret_hash, created_at, last_seen, create_key, phase, player_count, pending_host_reconnect FROM rooms ORDER BY created_at ASC')
      .toArray() as Array<Record<string, string | number>>,
  );
}

async function updateRoomState(code: string, gameState: Record<string, unknown>) {
  const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
  const response = await stub.fetch('https://room/internal/state-update', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId: HOST, socketId: 'host-sock', gameState }),
  });
  expect(response.status).toBe(200);
}

async function ttsBudget(ip: string, chars: number): Promise<Response> {
  return directory().fetch('https://directory/internal/tts-budget', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ip, chars }),
  });
}

async function ttsRequest(ip: string): Promise<Response> {
  return directory().fetch('https://directory/internal/tts-request', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ip }),
  });
}

describe('Directory', () => {
  beforeEach(async () => {
    await runInDurableObject(directory(), async (instance: Directory, state) => {
      await state.storage.deleteAll();
      (instance as unknown as { ensureSchema(): void }).ensureSchema();
    });
    expect(await roomRows()).toEqual([]);
  });

  it('allocates 4-letter room codes and indexes the host', async () => {
    const { roomCode: code, hostSecret } = await create();
    expect(code).toMatch(/^[A-Z]{4}$/);
    expect(hostSecret).toMatch(/^[a-f0-9]{32}$/);

    const rows = await roomRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code, host_id: HOST, pending_host_reconnect: 0 });
    expect(String(rows[0].host_secret_hash)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('upgrades a pre-batch schema in place', async () => {
    await runInDurableObject(directory(), async (instance: Directory, state) => {
      state.storage.sql.exec(`
        DROP TABLE IF EXISTS rooms;
        CREATE TABLE rooms (
          code TEXT PRIMARY KEY,
          host_id TEXT NOT NULL,
          host_secret_hash TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          phase TEXT NOT NULL DEFAULT 'LOBBY',
          player_count INTEGER NOT NULL DEFAULT 0,
          pending_host_reconnect INTEGER NOT NULL DEFAULT 0
        );
      `);

      expect(() =>
        (instance as unknown as { ensureSchema(): void }).ensureSchema(),
      ).not.toThrow();

      const columns = state.storage.sql
        .exec<{ name: string }>('PRAGMA table_info(rooms)')
        .toArray()
        .map((row) => row.name);
      expect(columns).toEqual(expect.arrayContaining(['last_seen', 'create_key']));

      const index = state.storage.sql
        .exec<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'rooms_by_create_key'",
        )
        .toArray();
      expect(index).toHaveLength(1);
    });
  });

  it('reaps idle rooms but keeps recently active ones', async () => {
    const now = Date.now();
    const sevenHoursAgo = now - 7 * 60 * 60 * 1000;
    await runInDurableObject(directory(), (_instance: Directory, state) => {
      state.storage.sql.exec(
        `INSERT INTO rooms (code, host_id, host_secret_hash, created_at, last_seen, phase, player_count, pending_host_reconnect)
         VALUES ('LIVE', 'other-host', 'abc', ?, ?, 'LOBBY', 0, 0),
                ('IDLE', 'other-host', 'abc', ?, ?, 'LOBBY', 0, 0)`,
        sevenHoursAgo,
        now,
        sevenHoursAgo,
        sevenHoursAgo,
      );
    });

    await runInDurableObject(directory(), async (instance: Directory) => {
      await instance.alarm();
    });

    const codes = (await roomRows())
      .map((row) => row.code)
      .filter((code) => code === 'LIVE' || code === 'IDLE');
    expect(codes).toEqual(['LIVE']);
  });

  it('rejects a malformed create key', async () => {
    await expect(create(HOST, 'sock-1', undefined, 'short')).rejects.toThrow(
      'INVALID_CREATE_KEY',
    );
  });

  it('replays an idempotent create with the same room and secret', async () => {
    const key = 'a'.repeat(32);
    const first = await create(HOST, 'sock-1', undefined, key);
    const replay = await create(HOST, 'sock-2', undefined, key);

    expect(replay.roomCode).toBe(first.roomCode);
    expect(replay.hostSecret).toBe(first.hostSecret);
    expect((await roomRows())[0]).toMatchObject({ code: first.roomCode, create_key: key });

    // A different key still needs the host secret for a second room.
    await expect(create(HOST, 'sock-3', undefined, 'b'.repeat(32))).rejects.toThrow(
      'HOST_SECRET_REQUIRED',
    );

    // A key replay must not leak a room to someone with the wrong secret.
    const second = await create(HOST, 'sock-4', first.hostSecret, 'c'.repeat(32));
    await expect(create(HOST, 'sock-5', 'f'.repeat(32), 'c'.repeat(32))).rejects.toThrow(
      'HOST_SECRET_REQUIRED',
    );
    expect((await roomRows()).map((row) => row.code)).toContain(second.roomCode);
  });

  it('drains legacy rooms without a host-secret hash', async () => {
    await runInDurableObject(directory(), (_instance: Directory, state) => {
      state.storage.sql.exec(
        `INSERT INTO rooms (code, host_id, created_at, phase, player_count, pending_host_reconnect)
         VALUES ('OLD1', ?, ?, 'LOBBY', 0, 0)`,
        HOST,
        Date.now(),
      );
    });

    const created = await create();
    expect(created.roomCode).not.toBe('OLD1');

    const rows = await roomRows();
    expect(rows.map((row) => row.code)).not.toContain('OLD1');
    expect(rows).toHaveLength(1);
  });

  it('keeps the per-IP create budget in durable storage', async () => {
    const results = await runInDurableObject(directory(), (instance: Directory) => {
      const calls: boolean[] = [];
      for (let i = 0; i < 11; i++) {
        calls.push((instance as unknown as { consumeCreate(ip: string): boolean }).consumeCreate('203.0.113.9'));
      }
      return calls;
    });
    expect(results.slice(0, 10)).toEqual(Array(10).fill(true));
    expect(results[10]).toBe(false);

    const row = await runInDurableObject(directory(), (_instance: Directory, state) =>
      state.storage.sql
        .exec<{ count: number }>("SELECT count FROM rate_limits WHERE key = 'create:203.0.113.9'")
        .toArray()[0],
    );
    expect(row.count).toBe(11);
  });

  it('requires the host secret to create another room for the same host', async () => {
    const first = await create();
    await expect(create()).rejects.toThrow('HOST_SECRET_REQUIRED');
    await expect(create(HOST, 'host-sock-x', 'ffffffffffffffffffffffffffffffff')).rejects.toThrow(
      'HOST_SECRET_REQUIRED',
    );

    const second = await create(HOST, 'host-sock-2', first.hostSecret);
    const third = await create(HOST, 'host-sock-3', first.hostSecret);

    const rows = await roomRows();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ code: first.roomCode, pending_host_reconnect: 1 });
    expect(rows[1]).toMatchObject({ code: second.roomCode, pending_host_reconnect: 0 });
    expect(rows[2]).toMatchObject({ code: third.roomCode, pending_host_reconnect: 0 });
  });

  it('closes the oldest room on the 4th room, then keeps the 2-active cap', async () => {
    const first = await create();
    await create(HOST, 'host-sock-2', first.hostSecret);
    await create(HOST, 'host-sock-3', first.hostSecret);
    await expect(create(HOST, 'host-sock-4', 'ffffffffffffffffffffffffffffffff')).rejects.toThrow(
      'HOST_SECRET_REQUIRED',
    );

    const fourth = await create(HOST, 'host-sock-4', first.hostSecret);

    const exists = await runInDurableObject(directory(), async (instance: Directory) =>
      instance.checkRoomExists(first.roomCode),
    );
    expect(exists).toBe(false);

    const rows = await roomRows();
    expect(rows.map((row) => row.code)).not.toContain(first.roomCode);
    expect(rows.map((row) => row.code)).toContain(fourth.roomCode);
    expect(rows.filter((row) => row.pending_host_reconnect === 0).length).toBeLessThanOrEqual(2);
  });

  it('returns fresh phase, player count and names from the room DO', async () => {
    const code = await create();
    await updateRoomState(code.roomCode, {
      roomCode: code.roomCode,
      phase: 'WRITING',
      players: {
        p1: { id: 'p1', name: 'Bob' },
        p2: { id: 'p2', name: '<b>Alice</b>' },
      },
    });

    const rooms = await runInDurableObject(directory(), async (instance: Directory) =>
      instance.roomsByHost(HOST, code.hostSecret),
    );
    expect(rooms).toHaveLength(1);
    expect(rooms[0]).toEqual({
      roomCode: code.roomCode,
      phase: 'WRITING',
      playerCount: 2,
      playerNames: ['Bob', 'Alice'],
      isGracePeriod: false,
      createdAt: expect.any(Number),
    });
  });

  it('hides rooms from anyone without the host secret', async () => {
    const code = await create();
    const rooms = (secret?: string) =>
      runInDurableObject(directory(), async (instance: Directory) =>
        instance.roomsByHost(HOST, secret),
      );

    expect(await rooms()).toEqual([]);
    expect(await rooms('f'.repeat(32))).toEqual([]);
    expect(await rooms(code.hostSecret)).toHaveLength(1);
  });

  it('self-heals a stale index row', async () => {
    await runInDurableObject(directory(), (_instance: Directory, state) => {
      state.storage.sql.exec(
        `INSERT INTO rooms (code, host_id, created_at, phase, player_count, pending_host_reconnect)
         VALUES ('ZZZZ', ?, ?, 'LOBBY', 0, 0)`,
        HOST,
        Date.now() - 7 * 60 * 60 * 1000,
      );
    });

    const exists = await runInDurableObject(directory(), async (instance: Directory) =>
      instance.checkRoomExists('ZZZZ'),
    );
    expect(exists).toBe(false);
    expect(await roomRows()).toEqual([]);
  });

  it('sweeps rooms older than six hours before allocating', async () => {
    await runInDurableObject(directory(), (_instance: Directory, state) => {
      state.storage.sql.exec(
        `INSERT INTO rooms (code, host_id, created_at, phase, player_count, pending_host_reconnect)
         VALUES ('YYYY', ?, ?, 'LOBBY', 0, 0)`,
        'other-host',
        Date.now() - 7 * 60 * 60 * 1000,
      );
    });

    await create();
    const rows = await roomRows();
    expect(rows.map((row) => row.code)).not.toContain('YYYY');
  });

  it('sweeps stale rooms when the alarm handler runs', async () => {
    await runInDurableObject(directory(), async (instance: Directory, state) => {
      state.storage.sql.exec(
        `INSERT INTO rooms (code, host_id, created_at, phase, player_count, pending_host_reconnect)
         VALUES ('XXXX', ?, ?, 'LOBBY', 0, 0)`,
        'other-host',
        Date.now() - 7 * 60 * 60 * 1000,
      );
      await instance.alarm();
    });

    expect((await roomRows()).map((row) => row.code)).not.toContain('XXXX');
  });

  it('enforces global and per-IP TTS character budgets', async () => {
    const first = await ttsBudget('1.1.1.1', 50);
    expect(first.status).toBe(200);

    const overIp = await ttsBudget('1.1.1.1', 20);
    expect(overIp.status).toBe(429);
    expect(await overIp.json()).toMatchObject({ error: 'TTS_BUDGET_EXCEEDED' });

    const second = await ttsBudget('2.2.2.2', 50);
    expect(second.status).toBe(200);

    const overGlobal = await ttsBudget('2.2.2.2', 1);
    expect(overGlobal.status).toBe(429);
  });

  it('caps TTS requests per IP and globally', async () => {
    expect((await ttsRequest('9.9.9.9')).status).toBe(200);
    expect((await ttsRequest('9.9.9.9')).status).toBe(200);

    const overIp = await ttsRequest('9.9.9.9');
    expect(overIp.status).toBe(429);
    expect(await overIp.json()).toMatchObject({ error: 'TTS_RATE_EXCEEDED' });

    expect((await ttsRequest('8.8.8.8')).status).toBe(200);
    expect((await ttsRequest('8.8.8.8')).status).toBe(429);
  });
});
