import type { Env } from './env';
import { emptyRoomMs, maxAudiencePerRoom, maxPlayersPerRoom, maxStateBytes, playerKickMs, roomGraceMs } from './env';
import {
  MAX_NAME_LENGTH,
  MAX_TTS_LENGTH,
  hashSecret,
  isObject,
  normalizeSecret,
  normalizeLanguage,
  normalizeRole,
  randomSecret,
  sanitize,
  stampPlayerEvent,
  timingSafeEqual,
  validatePlayerId,
  type Role,
} from './protocol';
import { getAudio } from './tts';

const DIRECTORY_NAME = 'directory';

interface RoomInfo {
  exists: true;
  roomCode: string;
  phase: string;
  playerCount: number;
  playerNames: string[];
  pendingHostReconnect: boolean;
  createdAt: number;
}

interface DeadlineRow {
  [key: string]: string | number | null;
  kind: string;
  key: string;
  at: number;
}

interface PlayerRow {
  [key: string]: string | number | null;
  id: string;
  name: string;
  role: string;
  connected: number;
  secret_hash: string;
  socket_id: string;
}

/**
 * One Durable Object per room. It owns the authoritative relay state, room
 * membership and reconnect/kick deadlines. Sockets themselves live in the
 * Directory gateway (see directory.ts); all outbound events go through it.
 */
export class BambooRoom {
  private readonly ctx: DurableObjectState;
  private readonly env: Env;
  private lastPersistAt = 0;
  private latestState: Record<string, unknown> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        connected INTEGER NOT NULL DEFAULT 0,
        last_seen INTEGER NOT NULL,
        secret_hash TEXT NOT NULL DEFAULT '',
        socket_id TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS deadlines (
        kind TEXT NOT NULL,
        key TEXT NOT NULL,
        at INTEGER NOT NULL,
        PRIMARY KEY (kind, key)
      );
    `);
    for (const column of [
      "secret_hash TEXT NOT NULL DEFAULT ''",
      "socket_id TEXT NOT NULL DEFAULT ''",
    ]) {
      try {
        this.ctx.storage.sql.exec(`ALTER TABLE players ADD COLUMN ${column}`);
      } catch {
        // Column already exists.
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      switch (url.pathname) {
        case '/internal/init':
          return await this.init(await readJson(request));
        case '/internal/info':
          return this.info();
        case '/internal/join':
          return await this.join(await readJson(request));
        case '/internal/state':
          return json({ state: this.readState() });
        case '/internal/state-update':
          return await this.stateUpdate(await readJson(request));
        case '/internal/host-event':
          return await this.hostEvent(await readJson(request));
        case '/internal/player-event':
          return await this.playerEvent(await readJson(request));
        case '/internal/narrator':
          return await this.narrator(await readJson(request));
        case '/internal/disconnect':
          return await this.disconnect(await readJson(request));
        case '/internal/empty':
          return await this.empty();
        case '/internal/grace':
          return await this.grace(await readJson(request));
        case '/internal/close':
          return await this.closeRoom(readString((await readJson(request)).reason) || 'ROOM_CLOSED');
        default:
          return json({ error: 'NOT_FOUND' }, 404);
      }
    } catch (error) {
      console.error('[Room] internal error', error);
      return json({ error: 'INTERNAL_ERROR' }, 500);
    }
  }

  // ---------------------------------------------------------------------------
  // Room lifecycle
  // ---------------------------------------------------------------------------

  private async init(body: Record<string, unknown>): Promise<Response> {
    if (this.meta('roomCode')) return json({ error: 'ROOM_EXISTS' }, 409);

    const roomCode = sanitize(body.roomCode, 4).toUpperCase();
    const hostId = validatePlayerId(body.hostId);
    const hostSocketId = sanitize(body.hostSocketId, 128);
    const hostSecretHash = sanitize(body.hostSecretHash, 64);
    if (
      !/^[A-Z]{4}$/.test(roomCode) ||
      !hostId ||
      !hostSocketId ||
      !/^[a-f0-9]{64}$/.test(hostSecretHash)
    ) {
      return json({ error: 'INVALID_INIT' }, 400);
    }

    const now = Date.now();
    this.metaSet('roomCode', roomCode);
    this.metaSet('hostId', hostId);
    this.metaSet('hostSocketId', hostSocketId);
    this.metaSet('hostSecretHash', hostSecretHash);
    this.metaSet('pendingHostReconnect', '0');
    this.metaSet('hostGraceReason', '');
    this.metaSet('createdAt', String(now));
    this.metaSet('phase', 'LOBBY');

    this.ctx.storage.sql.exec(
      'INSERT INTO players (id, name, role, connected, last_seen, socket_id) VALUES (?, ?, ?, 1, ?, ?)',
      hostId,
      '',
      'HOST',
      now,
      hostSocketId,
    );

    const initialState = {
      roomCode,
      players: {},
      audience: {},
      phase: 'LOBBY',
      currentRound: 0,
      totalRounds: 3,
      emotes: [],
    };
    this.writeState(initialState);
    this.latestState = initialState;
    this.lastPersistAt = now;

    return json({ ok: true, roomCode });
  }

  private info(): Response {
    const roomCode = this.meta('roomCode');
    if (!roomCode) return json({ error: 'ROOM_NOT_FOUND' }, 404);

    const state = this.latestState ?? this.readState();
    const players = isObject(state?.players) ? Object.values(state.players) : [];
    const playerNames = players
      .map((player) => (isObject(player) && typeof player.name === 'string' ? sanitize(player.name, MAX_NAME_LENGTH) : ''))
      .filter(Boolean);
    const fallbackPlayers = this.playerRows();

    const info: RoomInfo = {
      exists: true,
      roomCode,
      phase: typeof state?.phase === 'string' ? state.phase : this.meta('phase') || 'LOBBY',
      playerCount: players.length || fallbackPlayers.filter((player) => player.connected === 1).length,
      playerNames: playerNames.length
        ? playerNames
        : fallbackPlayers.map((player) => player.name).filter(Boolean),
      pendingHostReconnect: this.boolMeta('pendingHostReconnect'),
      createdAt: Number(this.meta('createdAt') || 0),
    };
    return json(info);
  }

  private async closeRoom(reason: string): Promise<Response> {
    const roomCode = this.meta('roomCode');
    if (!roomCode) return json({ ok: true, alreadyClosed: true });

    const createdAt = Number(this.meta('createdAt') || Date.now());
    console.log(`[Room] close ${roomCode} reason=${reason} lifetime=${Math.floor((Date.now() - createdAt) / 1000)}s`);

    await this.directory('/internal/room-closed', { roomCode, reason });

    for (const table of ['deadlines', 'players', 'state', 'meta']) {
      this.ctx.storage.sql.exec(`DELETE FROM ${table}`);
    }
    await this.ctx.storage.deleteAlarm();
    return json({ ok: true });
  }

  private async grace(body: Record<string, unknown>): Promise<Response> {
    if (!this.meta('roomCode')) return json({ error: 'ROOM_NOT_FOUND' }, 404);
    const reason = sanitize(body.reason, 40) || 'LIMIT_GRACE_EXPIRED';
    await this.applyHostGrace(reason);
    return json({ ok: true });
  }

  private async applyHostGrace(reason: string): Promise<void> {
    // A reconnect must see the host's latest state, not a write throttled to
    // the 5s persistence window. This is a rare, bounded flush.
    this.flushState();
    const oldHostSocket = this.meta('hostSocketId');
    this.metaSet('pendingHostReconnect', '1');
    this.metaSet('hostGraceReason', reason);
    this.metaSet('hostSocketId', '');
    await this.setDeadline('host_grace', 'room', Date.now() + roomGraceMs(this.env));
    await this.broadcast('hostDisconnected', undefined);
    await this.touchDirectory({ pendingHostReconnect: true });
    if (oldHostSocket) {
      await this.directory('/internal/demote', { socketId: oldHostSocket });
    }
  }

  private async empty(): Promise<Response> {
    if (!this.meta('roomCode') || this.deadlineAt('host_grace', 'room')) return json({ ok: true });
    if (!this.deadlineAt('empty_room', 'room')) {
      await this.setDeadline('empty_room', 'room', Date.now() + emptyRoomMs(this.env));
    }
    return json({ ok: true });
  }

  // ---------------------------------------------------------------------------
  // Membership
  // ---------------------------------------------------------------------------

  private async join(body: Record<string, unknown>): Promise<Response> {
    const roomCode = this.meta('roomCode');
    if (!roomCode) return json({ error: 'ROOM_NOT_FOUND' }, 404);

    const playerId = validatePlayerId(body.playerId);
    const socketId = sanitize(body.socketId, 128);
    const name = sanitize(body.name, MAX_NAME_LENGTH);
    const hostSecret = normalizeSecret(body.hostSecret);
    const playerSecret = normalizeSecret(body.playerSecret);
    if (!playerId || !socketId) return json({ error: 'INVALID_JOIN' }, 400);

    const hostId = this.meta('hostId') || '';
    const pending = this.boolMeta('pendingHostReconnect');
    const hostSocketId = this.meta('hostSocketId') || '';
    const isHostIdentity = playerId === hostId;
    let becameHost = false;

    if (isHostIdentity) {
      // The host id is public only in old builds; the server-issued secret is
      // the credential. Never fall back to accepting the id on its own.
      const storedHash = this.meta('hostSecretHash') || '';
      const suppliedHash = hostSecret ? await hashSecret(hostSecret) : '';
      if (!storedHash || !suppliedHash || !timingSafeEqual(suppliedHash, storedHash)) {
        return json({ error: 'HOST_SECRET_REQUIRED' }, 403);
      }
      becameHost = true;
      this.metaSet('hostSocketId', socketId);
      this.metaSet('pendingHostReconnect', '0');
      this.metaSet('hostGraceReason', '');
      await this.clearDeadline('host_grace', 'room');
      await this.broadcast('hostReconnected', undefined, { excludeSocketId: socketId });
      if (hostSocketId && hostSocketId !== socketId) {
        // A reconnect race or a deliberate second tab with the same secret:
        // the newest socket wins and the old one loses host authority.
        await this.directory('/internal/demote', { socketId: hostSocketId });
      }
    }

    const requestedRole = normalizeRole(body.role);
    const role: Role = isHostIdentity
      ? 'HOST'
      : requestedRole === 'AUDIENCE'
        ? 'AUDIENCE'
        : 'PLAYER';

    const existing = this.ctx.storage.sql
      .exec<PlayerRow>(
        'SELECT id, name, role, connected, secret_hash, socket_id FROM players WHERE id = ?',
        playerId,
      )
      .toArray()[0];

    let issuedPlayerSecret: string | undefined;
    let playerSecretHash = existing?.secret_hash || '';
    if (!isHostIdentity) {
      if (existing?.secret_hash) {
        const suppliedHash = playerSecret ? await hashSecret(playerSecret) : '';
        if (!suppliedHash || !timingSafeEqual(suppliedHash, existing.secret_hash)) {
          return json({ error: 'PLAYER_SECRET_REQUIRED' }, 403);
        }
        playerSecretHash = existing.secret_hash;
      } else {
        // First join (or a legacy row): mint the resume credential once.
        issuedPlayerSecret = randomSecret();
        playerSecretHash = await hashSecret(issuedPlayerSecret);
      }
    }
    const replacedSocketId =
      existing?.socket_id && existing.socket_id !== socketId ? existing.socket_id : '';

    if (!existing || existing.role !== role) {
      if (role === 'AUDIENCE') {
        const audienceCount =
          this.ctx.storage.sql
            .exec<{ count: number }>("SELECT COUNT(*) AS count FROM players WHERE role = 'AUDIENCE'")
            .toArray()[0]?.count ?? 0;
        if (audienceCount >= maxAudiencePerRoom(this.env)) {
          return json({ error: 'ROOM_FULL' }, 409);
        }
      } else {
        const playerCount =
          this.ctx.storage.sql
            .exec<{ count: number }>("SELECT COUNT(*) AS count FROM players WHERE role <> 'AUDIENCE'")
            .toArray()[0]?.count ?? 0;
        if (playerCount >= maxPlayersPerRoom(this.env) + 1) {
          return json({ error: 'ROOM_FULL' }, 409);
        }
      }
    }

    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO players (id, name, role, connected, last_seen, secret_hash, socket_id)
       VALUES (?, ?, ?, 1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE players.name END,
         role = excluded.role,
         connected = 1,
         last_seen = excluded.last_seen,
         secret_hash = excluded.secret_hash,
         socket_id = excluded.socket_id`,
      playerId,
      name,
      role,
      now,
      playerSecretHash,
      socketId,
    );
    if (replacedSocketId) {
      // The newest socket wins. The old socket's events are rejected by the
      // socket_id check; close it so it cannot linger.
      await this.directory('/internal/close-socket', { socketId: replacedSocketId });
    }
    await this.clearDeadline('player_kick', playerId);
    await this.touchDirectory({ pendingHostReconnect: becameHost ? false : pending });

    return json({
      success: true,
      state: this.publicState(this.readState()),
      becameHost,
      playerSecret: issuedPlayerSecret,
    });
  }

  private async disconnect(body: Record<string, unknown>): Promise<Response> {
    const roomCode = this.meta('roomCode');
    if (!roomCode) return json({ ok: true });

    const socketId = sanitize(body.socketId, 128);
    const playerId = sanitize(body.playerId, 50);
    const hostSocketId = this.meta('hostSocketId') || '';

    if (socketId && socketId === hostSocketId) {
      await this.applyHostGrace('HOST_TIMEOUT');
      return json({ ok: true, host: true });
    }
    if (playerId && playerId === (this.meta('hostId') || '')) {
      // A demoted old host socket closing must not start a player kick for the
      // host row; host grace/close is handled by the host path above.
      return json({ ok: true, host: true });
    }

    if (playerId) {
      const row = this.ctx.storage.sql
        .exec<{ socket_id: string }>('SELECT socket_id FROM players WHERE id = ?', playerId)
        .toArray()[0];
      if (row?.socket_id && row.socket_id !== socketId) {
        // A replaced/old socket closing must not disconnect the live player.
        return json({ ok: true, ignored: true });
      }
      this.ctx.storage.sql.exec('UPDATE players SET connected = 0, last_seen = ? WHERE id = ?', Date.now(), playerId);
      await this.setDeadline('player_kick', playerId, Date.now() + playerKickMs(this.env));
      await this.broadcast('playerDisconnected', { playerId });
      await this.touchDirectory({});
    }

    return json({ ok: true });
  }

  // ---------------------------------------------------------------------------
  // Relay
  // ---------------------------------------------------------------------------

  private async stateUpdate(body: Record<string, unknown>): Promise<Response> {
    if (!this.isHostRequest(body)) return json({ error: 'HOST_ONLY' }, 403);
    const gameState = body.gameState;
    if (!isObject(gameState)) return json({ error: 'INVALID_STATE' }, 400);

    const publicState = this.publicState(gameState)!;
    const serialized = JSON.stringify(publicState);
    if (new TextEncoder().encode(serialized).byteLength > maxStateBytes(this.env)) {
      return json({ error: 'STATE_TOO_LARGE' }, 413);
    }
    this.latestState = publicState;
    this.persistState(publicState, false);
    await this.broadcast('gameStateUpdate', publicState, {
      excludeSocketId: sanitize(body.socketId, 128),
    });
    return json({ ok: true });
  }

  private async hostEvent(body: Record<string, unknown>): Promise<Response> {
    if (!this.isHostRequest(body)) return json({ error: 'HOST_ONLY' }, 403);
    await this.broadcast('hostEvent', body.event, {
      excludeSocketId: sanitize(body.socketId, 128),
    });
    return json({ ok: true });
  }

  private async playerEvent(body: Record<string, unknown>): Promise<Response> {
    const senderId = validatePlayerId(body.senderId ?? body.playerId);
    const socketId = sanitize(body.socketId, 128);
    if (!senderId) return json({ error: 'PLAYER_EVENT_FORBIDDEN' }, 403);

    const sender = this.ctx.storage.sql
      .exec<PlayerRow>(
        'SELECT id, name, role, connected, secret_hash, socket_id FROM players WHERE id = ?',
        senderId,
      )
      .toArray()[0];
    if (!sender || sender.connected !== 1) return json({ error: 'PLAYER_EVENT_FORBIDDEN' }, 403);
    if (sender.socket_id && sender.socket_id !== socketId) {
      return json({ error: 'PLAYER_EVENT_FORBIDDEN' }, 403);
    }

    const event = stampPlayerEvent(body.event, senderId);
    if (!event) return json({ error: 'PLAYER_EVENT_FORBIDDEN' }, 403);

    const eventType = (event as { type: string }).type;
    if (eventType === 'SUBMIT_AUDIENCE_VOTE' && sender.role !== 'AUDIENCE') {
      return json({ error: 'PLAYER_EVENT_FORBIDDEN' }, 403);
    }
    if (
      sender.role === 'AUDIENCE' &&
      (eventType === 'SUBMIT_LIE' || eventType === 'SUBMIT_VOTE' || eventType === 'TOGGLE_READY')
    ) {
      return json({ error: 'PLAYER_EVENT_FORBIDDEN' }, 403);
    }

    if (eventType === 'JOIN_ROOM' || eventType === 'JOIN_AUDIENCE') {
      if (eventType === 'JOIN_ROOM' && sender.role === 'AUDIENCE') {
        const playerCount =
          this.ctx.storage.sql
            .exec<{ count: number }>("SELECT COUNT(*) AS count FROM players WHERE role <> 'AUDIENCE'")
            .toArray()[0]?.count ?? 0;
        if (playerCount >= maxPlayersPerRoom(this.env) + 1) {
          return json({ error: 'ROOM_FULL' }, 409);
        }
      }
      if (eventType === 'JOIN_AUDIENCE' && sender.role !== 'AUDIENCE') {
        const audienceCount =
          this.ctx.storage.sql
            .exec<{ count: number }>("SELECT COUNT(*) AS count FROM players WHERE role = 'AUDIENCE'")
            .toArray()[0]?.count ?? 0;
        if (audienceCount >= maxAudiencePerRoom(this.env)) {
          return json({ error: 'ROOM_FULL' }, 409);
        }
      }
      this.ctx.storage.sql.exec(
        'UPDATE players SET role = ? WHERE id = ?',
        eventType === 'JOIN_AUDIENCE' ? 'AUDIENCE' : 'PLAYER',
        senderId,
      );
    }

    await this.broadcast('playerEvent', event, {
      excludeSocketId: sanitize(body.socketId, 128),
    });
    return json({ ok: true });
  }

  private async narrator(body: Record<string, unknown>): Promise<Response> {
    if (!this.isHostRequest(body)) return json({ error: 'HOST_ONLY' }, 403);
    const roomCode = this.meta('roomCode') || '';
    const text = sanitize(body.text, MAX_TTS_LENGTH);
    const language = normalizeLanguage(body.language);
    const requestId = sanitize(body.requestId, 128);
    const socketId = sanitize(body.socketId, 128);
    const clientIp = sanitize(body.clientIp, 64) || 'unknown';
    if (!text) return json({ error: 'TEXT_REQUIRED' }, 400);

    try {
      const result = await getAudio(this.env, text, language, roomCode, async () => {
        const response = await this.directory('/internal/tts-budget', {
          ip: clientIp,
          chars: text.length,
        });
        if (!response.ok) throw new Error('TTS_BUDGET_EXCEEDED');
      });
      const state = this.readState();
      const isOnlineMode = state?.isOnlineMode === true;
      const payload = {
        audioUrl: result.url,
        text,
        requestId,
        isHit: result.isHit,
        hash: null,
      };
      await this.broadcast('playAudio', payload, isOnlineMode ? {} : { onlySocketId: socketId });
      return json({ ok: true, isHit: result.isHit });
    } catch (error) {
      if (error instanceof Error && error.message === 'TTS_BUDGET_EXCEEDED') {
        console.warn(`[Room] TTS budget exceeded room=${roomCode}`);
        return json({ error: 'TTS_BUDGET_EXCEEDED' }, 429);
      }
      console.error('[Room] narrator failed', error);
      return json({ error: 'TTS_FAILED' }, 500);
    }
  }

  private isHostRequest(body: Record<string, unknown>): boolean {
    const hostId = this.meta('hostId') || '';
    const hostSocketId = this.meta('hostSocketId') || '';
    return (
      !!hostId &&
      !!hostSocketId &&
      sanitize(body.playerId, 50) === hostId &&
      sanitize(body.socketId, 128) === hostSocketId
    );
  }

  // ---------------------------------------------------------------------------
  // Alarms
  // ---------------------------------------------------------------------------

  async alarm(): Promise<void> {
    if (!this.meta('roomCode')) return;

    const now = Date.now();
    const due = this.ctx.storage.sql
      .exec<DeadlineRow>('SELECT kind, key, at FROM deadlines WHERE at <= ? ORDER BY at ASC', now)
      .toArray();

    for (const deadline of due) {
      this.ctx.storage.sql.exec(
        'DELETE FROM deadlines WHERE kind = ? AND key = ?',
        deadline.kind,
        deadline.key,
      );

      if (!this.meta('roomCode')) return;

      if (deadline.kind === 'host_grace') {
        const reason = this.meta('hostGraceReason') || 'HOST_TIMEOUT';
        await this.closeRoom(reason);
        return;
      }

      if (deadline.kind === 'player_kick') {
        await this.broadcast('playerKicked', { playerId: deadline.key });
        this.ctx.storage.sql.exec('DELETE FROM players WHERE id = ?', deadline.key);
        await this.touchDirectory({});
        continue;
      }

      if (deadline.kind === 'empty_room') {
        await this.closeRoom('ROOM_EMPTY');
        return;
      }
    }

    await this.rescheduleAlarm();
  }

  private async setDeadline(kind: string, key: string, at: number): Promise<void> {
    this.ctx.storage.sql.exec(
      `INSERT INTO deadlines (kind, key, at) VALUES (?, ?, ?)
       ON CONFLICT(kind, key) DO UPDATE SET at = excluded.at`,
      kind,
      key,
      at,
    );
    await this.rescheduleAlarm();
  }

  private async clearDeadline(kind: string, key: string): Promise<void> {
    this.ctx.storage.sql.exec('DELETE FROM deadlines WHERE kind = ? AND key = ?', kind, key);
    await this.rescheduleAlarm();
  }

  private deadlineAt(kind: string, key: string): number | null {
    const row = this.ctx.storage.sql
      .exec<{ at: number }>('SELECT at FROM deadlines WHERE kind = ? AND key = ?', kind, key)
      .toArray()[0];
    return row?.at ?? null;
  }

  private async rescheduleAlarm(): Promise<void> {
    const row = this.ctx.storage.sql
      .exec<{ at: number | null }>('SELECT MIN(at) AS at FROM deadlines')
      .toArray()[0];
    if (row?.at == null) {
      await this.ctx.storage.deleteAlarm();
    } else {
      await this.ctx.storage.setAlarm(row.at);
    }
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  private readState(): Record<string, unknown> | null {
    const row = this.ctx.storage.sql
      .exec<{ json: string }>('SELECT json FROM state WHERE id = 1')
      .toArray()[0];
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.json);
      return isObject(parsed) ? this.publicState(parsed) : null;
    } catch {
      return null;
    }
  }

  /**
   * hostId is not an auth credential and must never leave the server in room
   * state (broadcast, join response or requestState).
   */
  private publicState(state: Record<string, unknown> | null): Record<string, unknown> | null {
    if (!state) return null;
    const { hostId: _hostId, ...rest } = state;
    return rest;
  }

  private writeState(state: Record<string, unknown>): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO state (id, json) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET json = excluded.json`,
      JSON.stringify(state),
    );
  }

  /**
   * Persist at most once every 5 seconds, plus immediately on a phase change.
   * The free plan's SQLite write budget is the reason for the throttle.
   */
  private flushState(): void {
    if (!this.latestState) return;
    this.writeState(this.latestState);
    const phase = typeof this.latestState.phase === 'string' ? this.latestState.phase : 'LOBBY';
    this.metaSet('phase', phase);
    this.lastPersistAt = Date.now();
  }

  private persistState(state: Record<string, unknown>, force: boolean): void {
    const now = Date.now();
    const phase = typeof state.phase === 'string' ? state.phase : 'LOBBY';
    const phaseChanged = phase !== (this.meta('phase') || 'LOBBY');
    if (!force && !phaseChanged && now - this.lastPersistAt < 5000) return;

    this.writeState(state);
    this.metaSet('phase', phase);
    this.lastPersistAt = now;
    if (phaseChanged) void this.touchDirectory({ phase });
  }

  // ---------------------------------------------------------------------------
  // Directory RPC
  // ---------------------------------------------------------------------------

  private async broadcast(
    event: string,
    data: unknown,
    options: { onlySocketId?: string; excludeSocketId?: string } = {},
  ): Promise<void> {
    const roomCode = this.meta('roomCode');
    if (!roomCode) return;
    await this.directory('/internal/broadcast', { roomCode, event, data, ...options });
  }

  private async touchDirectory(fields: Record<string, unknown>): Promise<void> {
    const roomCode = this.meta('roomCode');
    if (!roomCode) return;
    await this.directory('/internal/room-meta', { roomCode, ...fields });
  }

  private async directory(path: string, body: unknown): Promise<Response> {
    try {
      const id = this.env.DIRECTORY.idFromName(DIRECTORY_NAME);
      const stub = this.env.DIRECTORY.get(id);
      return await stub.fetch(`https://directory${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (error) {
      console.error('[Room] directory RPC failed', path, error);
      return new Response(null, { status: 503 });
    }
  }

  // ---------------------------------------------------------------------------
  // Meta helpers
  // ---------------------------------------------------------------------------

  private meta(key: string): string | null {
    const row = this.ctx.storage.sql
      .exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', key)
      .toArray()[0];
    return row?.value ?? null;
  }

  private metaSet(key: string, value: string): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      key,
      value,
    );
  }

  private boolMeta(key: string): boolean {
    return this.meta(key) === '1';
  }

  private playerRows(): PlayerRow[] {
    return this.ctx.storage.sql
      .exec<PlayerRow>('SELECT id, name, role, connected, secret_hash, socket_id FROM players ORDER BY last_seen ASC')
      .toArray();
  }
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    return isObject(value) ? value : {};
  } catch {
    return {};
  }
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
