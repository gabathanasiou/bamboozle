#!/usr/bin/env node
// wrangler-dev smoke test. Run with the Worker on :8787:
//   npm run dev
//   npm run smoke
//
// Exercises the native-WS protocol end to end: health, create/join/audience,
// relay, reconnect grace, player disconnect, room caps, rate limit and TTS
// cache hit. Set SMOKE_NEW_TTS=1 to also generate one new phrase.

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:8787';
const WS_URL = BASE.replace(/^http/, 'ws') + '/ws';
const CACHED_TEXT = 'This is it. The Final Round. Make it count.';
const CACHED_HASH = '5bf5806bef85eab8a06ee60a9c20b3b3';

let counter = 0;
const nextId = () => `smoke-${++counter}-${Math.random().toString(36).slice(2, 8)}`;

class Client {
  constructor(ws) {
    this.ws = ws;
    this.pending = new Map();
    this.queue = [];
    this.waiters = [];
    ws.addEventListener('message', (event) => this.onMessage(event.data));
  }

  static connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      const timer = setTimeout(() => reject(new Error('WS connect timeout')), 10000);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve(new Client(ws));
      });
      ws.addEventListener('error', (event) => {
        clearTimeout(timer);
        reject(new Error(`WS error: ${event.message || 'unknown'}`));
      });
    });
  }

  onMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.ok) pending.resolve(message.data);
      else pending.reject(new Error(message.error || 'ACK_ERROR'));
      return;
    }

    const waiter = this.waiters.findIndex((entry) => entry.event === message.event);
    if (waiter >= 0) {
      const [entry] = this.waiters.splice(waiter, 1);
      clearTimeout(entry.timer);
      entry.resolve(message.data);
    } else {
      this.queue.push(message);
    }
  }

  send(event, data) {
    this.ws.send(JSON.stringify({ event, data }));
  }

  ack(event, data, timeoutMs = 10000) {
    const id = nextId();
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ACK timeout: ${event}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.ws.send(JSON.stringify({ id, event, data }));
    return promise;
  }

  wait(event, timeoutMs = 10000) {
    const queued = this.queue.findIndex((message) => message.event === event);
    if (queued >= 0) return Promise.resolve(this.queue.splice(queued, 1)[0].data);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((entry) => entry.timer === timer);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error(`EVENT timeout: ${event}`));
      }, timeoutMs);
      this.waiters.push({ event, resolve, reject, timer });
    });
  }

  close() {
    this.ws.close();
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const results = [];
async function step(name, fn) {
  const started = Date.now();
  await fn();
  results.push({ name, ms: Date.now() - started });
  console.log(`  ok  ${name}`);
}

async function main() {
  console.log(`Smoke against ${BASE}`);

  await step('health + version', async () => {
    const health = await fetch(`${BASE}/health`).then((response) => response.json());
    assert(health.ok === true && health.service === 'bamboozle-rooms', 'health payload');
    const version = await fetch(`${BASE}/api/version`).then((response) => response.json());
    assert(typeof version.version === 'string', 'version payload');
  });

  const hostId = `smoke-host-${Date.now()}`;
  let roomCode;
  let hostSecret;
  let host = await Client.connect();
  let player = await Client.connect();
  let audience = await Client.connect();

  await step('createRoom + checkRoom', async () => {
    const created = await host.ack('createRoom', { hostId });
    roomCode = created.roomCode;
    hostSecret = created.hostSecret;
    assert(/^[A-Z]{4}$/.test(roomCode), `room code: ${roomCode}`);
    assert(/^[a-f0-9]{32}$/.test(hostSecret || ''), 'server-issued host secret');
    const check = await player.ack('checkRoom', { roomCode });
    assert(check.exists === true, 'checkRoom exists');
  });

  await step('joinRoom PLAYER + AUDIENCE with identical state', async () => {
    const playerResult = await player.ack('joinRoom', {
      roomCode,
      id: 'smoke-player',
      role: 'PLAYER',
      name: 'Smoke Player',
    });
    const audienceResult = await audience.ack('joinRoom', {
      roomCode,
      id: 'smoke-audience',
      role: 'AUDIENCE',
      name: 'Smoke Audience',
    });
    assert(playerResult.success === true, 'player join');
    assert(audienceResult.success === true, 'audience join');
    assert(same(playerResult.state, audienceResult.state), 'join states identical');
  });

  await step('requestState requires room membership', async () => {
    const outsider = await Client.connect();
    const denied = await outsider.ack('requestState', { roomCode });
    assert(denied === null, 'outsider read rejected');
    const member = await host.ack('requestState', { roomCode });
    assert(member && member.roomCode === roomCode, 'joined host can read its room');
    const other = await host.ack('requestState', { roomCode: 'ZZZZ' });
    assert(other === null, 'cannot read a different room');
    outsider.close();
  });

  await step('gameStateUpdate relay (exclude sender)', async () => {
    const gameState = {
      roomCode,
      phase: 'LOBBY',
      players: { 'smoke-player': { id: 'smoke-player', name: 'Smoke Player' } },
      audience: {},
      isOnlineMode: false,
      marker: 'smoke-state',
    };
    host.send('gameStateUpdate', { roomCode, gameState });
    const received = await player.wait('gameStateUpdate');
    assert(received.marker === 'smoke-state', 'player received state');
  });

  await step('playerEvent relay', async () => {
    player.send('playerEvent', {
      roomCode,
      event: { type: 'JOIN_ROOM', payload: { id: 'smoke-player', name: 'Smoke Player' } },
    });
    const received = await host.wait('playerEvent');
    assert(received.type === 'JOIN_ROOM', 'host received playerEvent');
  });

  await step('player disconnect notice', async () => {
    player.close();
    const received = await host.wait('playerDisconnected');
    assert(received.playerId === 'smoke-player', 'playerDisconnected payload');
  });

  await step('host reconnect grace + reclaim', async () => {
    host.close();
    const disconnected = await audience.wait('hostDisconnected');
    assert(disconnected === undefined, 'hostDisconnected has no payload');

    const newHost = await Client.connect();
    const result = await newHost.ack('joinRoom', {
      roomCode,
      id: hostId,
      role: 'HOST',
      hostSecret,
    });
    assert(result.success === true && result.becameHost === true, 'host reclaimed');
    const reconnected = await audience.wait('hostReconnected');
    assert(reconnected === undefined, 'hostReconnected has no payload');
    host = newHost;
  });

  await step('hostId alone cannot reclaim', async () => {
    const attacker = await Client.connect();
    const result = await attacker.ack('joinRoom', { roomCode, id: hostId, role: 'HOST' });
    assert(result?.error === 'HOST_SECRET_REQUIRED', `expected HOST_SECRET_REQUIRED, got ${JSON.stringify(result)}`);
    attacker.close();
  });

  await step('rate limit >20 events / 10s', async () => {
    const limited = await Client.connect();
    await limited.ack('joinRoom', { roomCode, id: 'smoke-rate', role: 'AUDIENCE' });
    let rejected = null;
    for (let i = 0; i < 20; i++) {
      try {
        await limited.ack('joinRoom', { roomCode, id: 'smoke-rate', role: 'AUDIENCE' });
      } catch (error) {
        rejected = error.message;
        break;
      }
    }
    assert(rejected === 'RATE_LIMITED', `expected RATE_LIMITED, got ${rejected}`);
    limited.close();
  });

  await step('2-room cap: 3rd graces, 4th closes oldest', async () => {
    const capHost = `smoke-cap-${Date.now()}`;
    const sockets = [await Client.connect(), await Client.connect(), await Client.connect()];
    const first = await sockets[0].ack('createRoom', { hostId: capHost });
    const missing = await sockets[1].ack('createRoom', { hostId: capHost });
    assert(
      missing?.error === 'HOST_SECRET_REQUIRED',
      `expected HOST_SECRET_REQUIRED, got ${JSON.stringify(missing)}`,
    );
    const second = await sockets[1].ack('createRoom', {
      hostId: capHost,
      hostSecret: first.hostSecret,
    });
    const third = await sockets[2].ack('createRoom', {
      hostId: capHost,
      hostSecret: first.hostSecret,
    });
    assert(new Set([first.roomCode, second.roomCode, third.roomCode]).size === 3, 'three unique rooms');

    let rooms = await sockets[0].ack('getRoomsByHost', { hostId: capHost });
    const graced = rooms.find((room) => room.roomCode === first.roomCode);
    assert(graced?.isGracePeriod === true, 'oldest is in grace');

    const fourthSocket = await Client.connect();
    const fourth = await fourthSocket.ack('createRoom', {
      hostId: capHost,
      hostSecret: first.hostSecret,
    });
    rooms = await fourthSocket.ack('getRoomsByHost', { hostId: capHost });
    assert(!rooms.some((room) => room.roomCode === first.roomCode), 'oldest closed');
    assert(rooms.some((room) => room.roomCode === fourth.roomCode), '4th room exists');
    sockets.forEach((socket) => socket.close());
    fourthSocket.close();
  });

  await step('TTS cache hit (existing GCS object)', async () => {
    host.send('requestNarrator', { roomCode, text: CACHED_TEXT, language: 'en', requestId: 'smoke-cached' });
    const audio = await host.wait('playAudio', 30000);
    assert(audio.isHit === true, 'isHit true');
    assert(audio.audioUrl.includes(CACHED_HASH), 'same MD5 URL');
    assert(audio.requestId === 'smoke-cached', 'requestId echoed');
    const response = await fetch(audio.audioUrl, { method: 'HEAD' });
    assert(response.ok, `audio URL ${response.status}`);
    console.log(`       ${audio.audioUrl}`);
  });

  if (process.env.SMOKE_NEW_TTS === '1') {
    await step('TTS generate + upload (new phrase)', async () => {
      const text = `Smoke test ${Date.now()}`;
      host.send('requestNarrator', { roomCode, text, language: 'en', requestId: 'smoke-new' });
      const audio = await host.wait('playAudio', 60000);
      assert(audio.isHit === false, 'isHit false');
      const response = await fetch(audio.audioUrl, { method: 'HEAD' });
      assert(response.ok, `new audio URL ${response.status}`);
      console.log(`       ${audio.audioUrl}`);
    });
  }

  host.close();
  audience.close();
  console.log(`\nPASS ${results.length} steps`);
  console.log(JSON.stringify({ roomCode, results }, null, 2));
  // Undici keeps idle sockets alive; the smoke is complete at this point.
  process.exit(0);
}

main().catch((error) => {
  console.error('\nFAIL', error.message);
  process.exit(1);
});
