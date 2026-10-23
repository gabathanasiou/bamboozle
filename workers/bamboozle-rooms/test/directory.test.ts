import { env, runInDurableObject } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Directory } from '../src/directory';

const HOST = 'host-directory';
const directory = () => env.DIRECTORY.get(env.DIRECTORY.idFromName('directory'));

async function create(
  hostId = HOST,
  socketId = 'host-sock',
  secret?: string,
): Promise<{ roomCode: string; hostSecret: string }> {
  return runInDurableObject(directory(), async (instance: Directory) =>
    instance.createRoomForHost(hostId, socketId, secret),
  );
}

async function roomRows() {
  return runInDurableObject(directory(), (_instance: Directory, state) =>
    state.storage.sql
      .exec('SELECT code, host_id, host_secret_hash, created_at, phase, player_count, pending_host_reconnect FROM rooms ORDER BY created_at ASC')
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
      instance.roomsByHost(HOST),
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
});
