import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BambooRoom } from '../src/room';

const ROOM = 'ABCD';
const HOST = 'host-1';
const HOST_SOCKET = 'sock-host';

const stub = () => env.ROOMS.get(env.ROOMS.idFromName(ROOM));

async function call(path: string, body?: unknown): Promise<Response> {
  return stub().fetch(`https://room${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function initRoom(): Promise<void> {
  const response = await call('/internal/init', {
    roomCode: ROOM,
    hostId: HOST,
    hostSocketId: HOST_SOCKET,
  });
  expect(response.status).toBe(200);
}

async function join(playerId: string, socketId: string, role = 'PLAYER', name = 'Player'): Promise<any> {
  const response = await call('/internal/join', { playerId, socketId, role, name });
  expect(response.status).toBe(200);
  return response.json();
}

/** Move a 60s deadline into the past so runDurableObjectAlarm has due work. */
async function expireDeadlines(kind: string): Promise<void> {
  await runInDurableObject(stub(), (_instance: BambooRoom, state) => {
    state.storage.sql.exec('UPDATE deadlines SET at = ? WHERE kind = ?', Date.now() - 1000, kind);
  });
}

describe('BambooRoom', () => {
  beforeEach(async () => {
    await runInDurableObject(stub(), async (instance: BambooRoom, state) => {
      await state.storage.deleteAll();
      // deleteAll removes the SQLite tables too; the constructor normally
      // creates them, so recreate before the test body runs.
      (instance as unknown as { ensureSchema(): void }).ensureSchema();
    });
    await initRoom();
  });

  it('initialises one minimal LOBBY state', async () => {
    const info = await call('/internal/info').then((response) => response.json() as Promise<any>);
    expect(info).toMatchObject({ exists: true, roomCode: ROOM, hostId: HOST, phase: 'LOBBY' });

    const { state } = await call('/internal/state').then((response) => response.json() as Promise<any>);
    expect(state).toMatchObject({ roomCode: ROOM, phase: 'LOBBY', currentRound: 0, totalRounds: 3 });
  });

  it('refuses to initialise the same room twice', async () => {
    const response = await call('/internal/init', {
      roomCode: ROOM,
      hostId: HOST,
      hostSocketId: HOST_SOCKET,
    });
    expect(response.status).toBe(409);
  });

  it('joins a player and returns the stored state', async () => {
    const result = await join('player-1', 'sock-player', 'PLAYER', '<b>Bob</b>');
    expect(result).toMatchObject({ success: true, becameHost: false });
    expect(result.state.roomCode).toBe(ROOM);
  });

  it('lets only the current host socket update state', async () => {
    const rejected = await call('/internal/state-update', {
      playerId: 'player-1',
      socketId: 'sock-player',
      gameState: { phase: 'LOBBY' },
    });
    expect(rejected.status).toBe(403);

    const accepted = await call('/internal/state-update', {
      playerId: HOST,
      socketId: HOST_SOCKET,
      gameState: { roomCode: ROOM, phase: 'WRITING', marker: 1, players: {} },
    });
    expect(accepted.status).toBe(200);

    const { state } = await call('/internal/state').then((response) => response.json() as Promise<any>);
    expect(state).toMatchObject({ phase: 'WRITING', marker: 1 });
  });

  it('persists a phase change immediately but throttles same-phase writes to 5s', async () => {
    await call('/internal/state-update', {
      playerId: HOST,
      socketId: HOST_SOCKET,
      gameState: { roomCode: ROOM, phase: 'WRITING', marker: 1, players: {} },
    });
    await call('/internal/state-update', {
      playerId: HOST,
      socketId: HOST_SOCKET,
      gameState: { roomCode: ROOM, phase: 'WRITING', marker: 2, players: {} },
    });

    const { state } = await call('/internal/state').then((response) => response.json() as Promise<any>);
    expect(state.marker).toBe(1);

    await call('/internal/state-update', {
      playerId: HOST,
      socketId: HOST_SOCKET,
      gameState: { roomCode: ROOM, phase: 'VOTING', marker: 3, players: {} },
    });
    const afterPhaseChange = await call('/internal/state').then((response) => response.json() as Promise<any>);
    expect(afterPhaseChange.state).toMatchObject({ phase: 'VOTING', marker: 3 });
  });

  it('flushes the latest state when host grace starts (reconnect safety)', async () => {
    await call('/internal/state-update', {
      playerId: HOST,
      socketId: HOST_SOCKET,
      gameState: { roomCode: ROOM, phase: 'LOBBY', marker: 'fresh', usedQuestionIds: [], players: {} },
    });

    // Same phase inside the 5s throttle: not in SQLite yet.
    const before = await call('/internal/state').then((response) => response.json() as Promise<any>);
    expect(before.state.marker).toBeUndefined();

    await call('/internal/disconnect', { socketId: HOST_SOCKET, playerId: HOST });
    const after = await call('/internal/state').then((response) => response.json() as Promise<any>);
    expect(after.state).toMatchObject({ marker: 'fresh', usedQuestionIds: [] });
  });

  it('starts host grace on close and closes the room when the alarm fires', async () => {
    const response = await call('/internal/disconnect', { socketId: HOST_SOCKET, playerId: HOST });
    expect(response.status).toBe(200);

    const info = await call('/internal/info').then((res) => res.json() as Promise<any>);
    expect(info.pendingHostReconnect).toBe(true);

    await expireDeadlines('host_grace');
    const ran = await runDurableObjectAlarm(stub());
    expect(ran).toBe(true);

    const after = await call('/internal/info');
    expect(after.status).toBe(404);
  });

  it('reclaims host within grace and clears the deadline', async () => {
    await call('/internal/disconnect', { socketId: HOST_SOCKET, playerId: HOST });
    const result = await join(HOST, 'sock-host-new', 'HOST', '');

    expect(result.becameHost).toBe(true);
    const info = await call('/internal/info').then((res) => res.json() as Promise<any>);
    expect(info.pendingHostReconnect).toBe(false);
    expect(await stub().fetch('https://room/internal/info').then((res) => res.status)).toBe(200);
  });

  it('kicks a disconnected player when the alarm fires', async () => {
    await join('player-1', 'sock-player', 'PLAYER', 'Bob');
    await call('/internal/disconnect', { socketId: 'sock-player', playerId: 'player-1' });

    await expireDeadlines('player_kick');
    expect(await runDurableObjectAlarm(stub())).toBe(true);

    const rows = await runInDurableObject(stub(), (_instance: BambooRoom, state) =>
      state.storage.sql.exec('SELECT id FROM players WHERE id = ?', 'player-1').toArray(),
    );
    expect(rows).toHaveLength(0);
  });

  it('closes a truly empty room after its grace alarm', async () => {
    await call('/internal/empty', {});
    await expireDeadlines('empty_room');
    expect(await runDurableObjectAlarm(stub())).toBe(true);
    expect((await call('/internal/info')).status).toBe(404);
  });
});
