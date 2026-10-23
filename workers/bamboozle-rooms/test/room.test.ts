import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { hashHostSecret } from '../src/protocol';
import type { BambooRoom } from '../src/room';

const ROOM = 'ABCD';
const HOST = 'host-1';
const HOST_SOCKET = 'sock-host';
const HOST_SECRET = '0123456789abcdef0123456789abcdef';

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
    hostSecretHash: await hashHostSecret(HOST_SECRET),
  });
  expect(response.status).toBe(200);
}

async function join(
  playerId: string,
  socketId: string,
  role = 'PLAYER',
  name = 'Player',
  hostSecret?: string,
): Promise<any> {
  const response = await call('/internal/join', { playerId, socketId, role, name, hostSecret });
  expect(response.status).toBe(200);
  return response.json();
}

async function joinStatus(
  playerId: string,
  socketId: string,
  role = 'PLAYER',
  name = 'Player',
  hostSecret?: string,
): Promise<Response> {
  return call('/internal/join', { playerId, socketId, role, name, hostSecret });
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
    expect(info).toMatchObject({ exists: true, roomCode: ROOM, phase: 'LOBBY' });
    expect(info.hostId).toBeUndefined();

    const { state } = await call('/internal/state').then((response) => response.json() as Promise<any>);
    expect(state).toMatchObject({ roomCode: ROOM, phase: 'LOBBY', currentRound: 0, totalRounds: 3 });
  });

  it('refuses to initialise the same room twice', async () => {
    const response = await call('/internal/init', {
      roomCode: ROOM,
      hostId: HOST,
      hostSocketId: HOST_SOCKET,
      hostSecretHash: await hashHostSecret(HOST_SECRET),
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

  it('never broadcasts or returns hostId in room state', async () => {
    await call('/internal/state-update', {
      playerId: HOST,
      socketId: HOST_SOCKET,
      gameState: { roomCode: ROOM, phase: 'WRITING', hostId: HOST, players: {} },
    });

    const { state } = await call('/internal/state').then((response) => response.json() as Promise<any>);
    expect(state.hostId).toBeUndefined();
    expect(state.phase).toBe('WRITING');

    const joined = await join('player-1', 'sock-player');
    expect(joined.state.hostId).toBeUndefined();
  });

  it('drops host-only events sent on the player channel', async () => {
    await join('player-1', 'sock-player');

    for (const type of ['START_GAME', 'RESTART_GAME', 'REMOVE_PLAYER', 'UPDATE_ROUNDS']) {
      const response = await call('/internal/player-event', {
        senderId: 'player-1',
        socketId: 'sock-player',
        event: { type, payload: { playerId: HOST, rounds: 99 } },
      });
      expect(response.status).toBe(403);
    }
  });

  it('accepts allowlisted player events and enforces audience roles', async () => {
    await join('player-1', 'sock-player', 'PLAYER', 'Bob');
    await join('aud-1', 'sock-aud', 'AUDIENCE', 'Watcher');

    const lie = await call('/internal/player-event', {
      senderId: 'player-1',
      socketId: 'sock-player',
      event: { type: 'SUBMIT_LIE', payload: { playerId: HOST, text: 'a lie' } },
    });
    expect(lie.status).toBe(200);

    const forgedAudienceVote = await call('/internal/player-event', {
      senderId: 'player-1',
      socketId: 'sock-player',
      event: { type: 'SUBMIT_AUDIENCE_VOTE', payload: { playerId: 'aud-1', answerId: 'a1' } },
    });
    expect(forgedAudienceVote.status).toBe(403);

    const audienceLie = await call('/internal/player-event', {
      senderId: 'aud-1',
      socketId: 'sock-aud',
      event: { type: 'SUBMIT_LIE', payload: { playerId: 'aud-1', text: 'a lie' } },
    });
    expect(audienceLie.status).toBe(403);

    const audienceVote = await call('/internal/player-event', {
      senderId: 'aud-1',
      socketId: 'sock-aud',
      event: { type: 'SUBMIT_AUDIENCE_VOTE', payload: { playerId: 'player-1', answerId: 'a1' } },
    });
    expect(audienceVote.status).toBe(200);
  });

  it('enforces server-side player and audience caps', async () => {
    await join('p1', 's1');
    await join('p2', 's2');
    expect((await joinStatus('p3', 's3')).status).toBe(409);

    await join('a1', 'sa1', 'AUDIENCE');
    await join('a2', 'sa2', 'AUDIENCE');
    expect((await joinStatus('a3', 'sa3', 'AUDIENCE')).status).toBe(409);
    expect((await joinStatus('a1', 'sa1', 'PLAYER')).status).toBe(409);
  });

  it('rejects an oversized game state', async () => {
    const response = await call('/internal/state-update', {
      playerId: HOST,
      socketId: HOST_SOCKET,
      gameState: { roomCode: ROOM, phase: 'LOBBY', players: {}, blob: 'x'.repeat(2000) },
    });
    expect(response.status).toBe(413);
  });

  it('refuses player events from sockets that never joined', async () => {
    const response = await call('/internal/player-event', {
      senderId: 'ghost',
      socketId: 'sock-ghost',
      event: { type: 'SUBMIT_LIE', payload: { playerId: 'ghost', text: 'hello' } },
    });
    expect(response.status).toBe(403);
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

  it('reclaims host within grace with the server-issued secret', async () => {
    await call('/internal/disconnect', { socketId: HOST_SOCKET, playerId: HOST });
    const result = await join(HOST, 'sock-host-new', 'HOST', '', HOST_SECRET);

    expect(result.becameHost).toBe(true);
    const info = await call('/internal/info').then((res) => res.json() as Promise<any>);
    expect(info.pendingHostReconnect).toBe(false);
    expect(await stub().fetch('https://room/internal/info').then((res) => res.status)).toBe(200);
  });

  it('refuses host reclaim with only the public host id', async () => {
    await call('/internal/disconnect', { socketId: HOST_SOCKET, playerId: HOST });

    expect((await joinStatus(HOST, 'sock-evil', 'HOST')).status).toBe(403);
    expect((await joinStatus(HOST, 'sock-evil', 'HOST', 'Evil', 'ffffffffffffffffffffffffffffffff')).status).toBe(403);

    const info = await call('/internal/info').then((res) => res.json() as Promise<any>);
    expect(info.pendingHostReconnect).toBe(true);
  });

  it('rejects __proto__ and other non-id player ids', async () => {
    for (const id of ['__proto__', 'constructor', 'prototype', 'bad id!', '']) {
      expect((await joinStatus(id, 'sock-evil')).status).toBe(400);
    }
    const result = await join('player-1', 'sock-player', 'PLAYER', 'Bob');
    expect(result.success).toBe(true);
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
