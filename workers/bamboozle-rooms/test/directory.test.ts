import { env, runInDurableObject } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Directory } from '../src/directory';

const HOST = 'host-directory';
const directory = () => env.DIRECTORY.get(env.DIRECTORY.idFromName('directory'));

async function create(hostId = HOST, socketId = 'host-sock'): Promise<string> {
  return runInDurableObject(directory(), async (instance: Directory) =>
    instance.createRoomForHost(hostId, socketId),
  );
}

async function roomRows() {
  return runInDurableObject(directory(), (_instance: Directory, state) =>
    state.storage.sql
      .exec('SELECT code, host_id, created_at, phase, player_count, pending_host_reconnect FROM rooms ORDER BY created_at ASC')
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

describe('Directory', () => {
  beforeEach(async () => {
    await runInDurableObject(directory(), async (instance: Directory, state) => {
      await state.storage.deleteAll();
      (instance as unknown as { ensureSchema(): void }).ensureSchema();
    });
    expect(await roomRows()).toEqual([]);
  });

  it('allocates 4-letter room codes and indexes the host', async () => {
    const code = await create();
    expect(code).toMatch(/^[A-Z]{4}$/);

    const rows = await roomRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code, host_id: HOST, pending_host_reconnect: 0 });
  });

  it('moves the oldest room to grace on the 3rd room', async () => {
    const first = await create();
    const second = await create();
    const third = await create();
    expect(new Set([first, second, third]).size).toBe(3);

    const rows = await roomRows();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ code: first, pending_host_reconnect: 1 });
    expect(rows[1]).toMatchObject({ code: second, pending_host_reconnect: 0 });
    expect(rows[2]).toMatchObject({ code: third, pending_host_reconnect: 0 });
  });

  it('closes the oldest room on the 4th room, then keeps the 2-active cap', async () => {
    const first = await create();
    await create();
    await create();
    const fourth = await create(undefined, 'host-sock-4');

    const exists = await runInDurableObject(directory(), async (instance: Directory) =>
      instance.checkRoomExists(first),
    );
    expect(exists).toBe(false);

    const rows = await roomRows();
    expect(rows.map((row) => row.code)).not.toContain(first);
    expect(rows.map((row) => row.code)).toContain(fourth);
    expect(rows.filter((row) => row.pending_host_reconnect === 0).length).toBeLessThanOrEqual(2);
  });

  it('returns fresh phase, player count and names from the room DO', async () => {
    const code = await create();
    await updateRoomState(code, {
      roomCode: code,
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
      roomCode: code,
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
});
