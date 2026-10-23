import type { Env } from './env';
import {
  maxCreatesPerHour,
  maxSocketsPerIp,
  maxSocketsTotal,
  maxTotalRooms,
  maxUpgradesPerMinute,
  ttsDailyChars,
  ttsDailyRequests,
  ttsIpDailyChars,
  ttsIpDailyRequests,
} from './env';
import { authorizeHost } from './auth';
import {
  MAX_CONCURRENT_ROOMS_PER_HOST,
  MAX_FRAME_BYTES,
  EVENT_RATE_WINDOW,
  RATE_LIMITED_EVENTS,
  READ_EVENTS,
  consumeRate,
  hashSecret,
  isPlayerEventType,
  normalizeHostId,
  normalizeCreateKey,
  normalizeSecret,
  normalizeRoomCode,
  normalizeRole,
  parseClientMessage,
  randomSecret,
  sanitize,
  timingSafeEqual,
  validatePlayerId,
  type RateState,
  type ServerAck,
  type SocketAttachment,
} from './protocol';

const SIX_HOURS = 6 * 60 * 60 * 1000;
const CREATE_WINDOW = 60 * 60 * 1000;
const MAX_READS_PER_IP_WINDOW = 60;
const ROOM_COLUMNS =
  'code, host_id, host_secret_hash, created_at, last_seen, create_key, phase, player_count, pending_host_reconnect';

interface RoomRow {
  [key: string]: string | number | null;
  code: string;
  host_id: string;
  host_secret_hash: string;
  created_at: number;
  last_seen: number;
  create_key: string;
  phase: string;
  player_count: number;
  pending_host_reconnect: number;
}

interface RoomInfo {
  exists: true;
  roomCode: string;
  phase: string;
  playerCount: number;
  playerNames: string[];
  pendingHostReconnect: boolean;
  createdAt: number;
}

interface RoomSummary {
  roomCode: string;
  phase: string;
  playerCount: number;
  playerNames: string[];
  isGracePeriod: boolean;
  createdAt: number;
}

/**
 * The single global Directory Durable Object.
 *
 * It is both the room-code index (plan §6) and the phase-1 socket gateway:
 * every /ws connection lands here because the Worker must choose a DO before
 * the first joinRoom message. It tags sockets with their room, enforces the
 * per-socket rate limit, and relays events to the authoritative BambooRoom DO.
 * BambooRoom calls back here to broadcast.
 */
export class Directory {
  private readonly ctx: DurableObjectState;
  private readonly env: Env;
  private ipRates = new Map<string, RateState>();
  private upgradeRates = new Map<string, RateState>();

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        code TEXT PRIMARY KEY,
        host_id TEXT NOT NULL,
        host_secret_hash TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL DEFAULT 0,
        create_key TEXT NOT NULL DEFAULT '',
        phase TEXT NOT NULL DEFAULT 'LOBBY',
        player_count INTEGER NOT NULL DEFAULT 0,
        pending_host_reconnect INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS rooms_by_host ON rooms(host_id);
      CREATE INDEX IF NOT EXISTS rooms_by_created ON rooms(created_at);
      CREATE INDEX IF NOT EXISTS rooms_by_create_key ON rooms(host_id, create_key);

      CREATE TABLE IF NOT EXISTS tts_budget (
        key TEXT PRIMARY KEY,
        day TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS rate_limits (
        key TEXT PRIMARY KEY,
        window_start INTEGER NOT NULL,
        count INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    // Existing deployments predate these columns.
    for (const column of [
      "host_secret_hash TEXT NOT NULL DEFAULT ''",
      "last_seen INTEGER NOT NULL DEFAULT 0",
      "create_key TEXT NOT NULL DEFAULT ''",
    ]) {
      try {
        this.ctx.storage.sql.exec(`ALTER TABLE rooms ADD COLUMN ${column}`);
      } catch {
        // Column already exists.
      }
    }
    // Rooms created before last_seen existed are as fresh as their creation.
    this.ctx.storage.sql.exec('UPDATE rooms SET last_seen = created_at WHERE last_seen = 0');
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/ws') {
        void this.scheduleSweep();
        return this.handleWebSocket(request);
      }
      if (url.pathname === '/internal/broadcast') return await this.internalBroadcast(request);
      if (url.pathname === '/internal/room-closed') return await this.internalRoomClosed(request);
      if (url.pathname === '/internal/room-meta') return await this.internalRoomMeta(request);
      if (url.pathname === '/internal/demote') return await this.internalDemote(request);
      if (url.pathname === '/internal/close-socket') return await this.internalCloseSocket(request);
      if (url.pathname === '/internal/tts-budget') return await this.internalTtsBudget(request);
      if (url.pathname === '/internal/tts-request') return await this.internalTtsRequest(request);
      return json({ error: 'NOT_FOUND' }, 404);
    } catch (error) {
      console.error('[Directory] internal error', error);
      return json({ error: 'INTERNAL_ERROR' }, 500);
    }
  }

  // ---------------------------------------------------------------------------
  // WebSocket gateway
  // ---------------------------------------------------------------------------

  private handleWebSocket(request: Request): Response {
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const clientIp = (request.headers.get('cf-connecting-ip') ||
      request.headers.get('x-real-ip') ||
      request.headers.get('x-forwarded-for') ||
      '')
      .split(',')[0]
      .trim()
      .slice(0, 64);

    const sockets = this.ctx.getWebSockets();
    if (sockets.length >= maxSocketsTotal(this.env)) {
      return new Response('Too many connections', { status: 429 });
    }
    if (clientIp) {
      const now = Date.now();
      const upgrade = consumeRate(
        this.upgradeRates.get(clientIp) ?? { count: 0, windowStart: now },
        now,
        maxUpgradesPerMinute(this.env),
        60_000,
      );
      this.upgradeRates.set(clientIp, upgrade.next);
      if (this.upgradeRates.size > 5000) {
        const cutoff = now - 10 * 60 * 1000;
        for (const [key, state] of this.upgradeRates) {
          if (state.windowStart < cutoff) this.upgradeRates.delete(key);
        }
      }
      if (upgrade.limited) {
        return new Response('Too many connection attempts', { status: 429 });
      }

      const fromIp = sockets.filter((socket) => this.attachment(socket)?.clientIp === clientIp).length;
      if (fromIp >= maxSocketsPerIp(this.env)) {
        return new Response('Too many connections from this address', { status: 429 });
      }
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const attachment: SocketAttachment = {
      socketId: crypto.randomUUID(),
      roomCode: null,
      playerId: null,
      role: null,
      isHost: false,
      rate: { count: 0, windowStart: Date.now() },
      clientIp,
    };
    server.serializeAttachment(attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const parsed = parseClientMessage(message);
    if (!parsed.ok) {
      if (parsed.id) this.sendAck(ws, parsed.id, false, parsed.error);
      else if (parsed.error === 'FRAME_TOO_LARGE') {
        ws.send(JSON.stringify({ event: 'error', data: { error: 'FRAME_TOO_LARGE' } }));
      }
      return;
    }

    const { message: clientMessage } = parsed;
    const attachment = this.attachment(ws);
    if (!attachment) {
      ws.close(1011, 'missing socket attachment');
      return;
    }

    if (RATE_LIMITED_EVENTS.has(clientMessage.event)) {
      const now = Date.now();
      const rate = consumeRate(attachment.rate, now);
      attachment.rate = rate.next;
      ws.serializeAttachment(attachment);
      if (rate.limited) {
        if (clientMessage.id) this.sendAck(ws, clientMessage.id, false, 'RATE_LIMITED');
        return;
      }

      if (READ_EVENTS.has(clientMessage.event) && attachment.clientIp) {
        const ipKey = attachment.clientIp;
        const ipRate = consumeRate(
          this.ipRates.get(ipKey) ?? { count: 0, windowStart: now },
          now,
          MAX_READS_PER_IP_WINDOW,
          EVENT_RATE_WINDOW,
        );
        this.ipRates.set(ipKey, ipRate.next);
        if (this.ipRates.size > 5000) {
          const cutoff = now - 10 * 60 * 1000;
          for (const [key, state] of this.ipRates) {
            if (state.windowStart < cutoff) this.ipRates.delete(key);
          }
        }
        if (ipRate.limited) {
          if (clientMessage.id) this.sendAck(ws, clientMessage.id, false, 'RATE_LIMITED');
          return;
        }
      }
    }

    try {
      await this.dispatch(ws, attachment, clientMessage);
    } catch (error) {
      console.error('[Directory] dispatch failed', clientMessage.event, error);
      if (clientMessage.id) this.sendAck(ws, clientMessage.id, false, 'INTERNAL_ERROR');
    }
  }

  private async dispatch(
    ws: WebSocket,
    attachment: SocketAttachment,
    message: { id?: string; event: string; data?: unknown },
  ): Promise<void> {
    const data = isRecord(message.data) ? message.data : {};
    const ack = (value: unknown) => {
      if (message.id) this.sendAck(ws, message.id, true, value);
    };

    switch (message.event) {
      case 'checkRoom': {
        const code = normalizeRoomCode(data.roomCode);
        ack({ exists: code ? await this.checkRoomExists(code) : false });
        return;
      }

      case 'getRoomsByHost': {
        const hostId = normalizeHostId(data.hostId);
        ack(hostId ? await this.roomsByHost(hostId, data.hostSecret) : []);
        return;
      }

      case 'createRoom': {
        if (attachment.roomCode) {
          // One socket owns one room. This also stops a client from leaving a
          // trail of zombie rooms by creating repeatedly on the same socket.
          ack({ error: 'ALREADY_IN_ROOM' });
          return;
        }
        const hostId = normalizeHostId(data.hostId);
        if (!hostId) {
          ack({ error: 'INVALID_HOST_ID' });
          return;
        }
        const auth = await authorizeHost(
          new Request('https://bamboozle-rooms.internal/ws'),
          { hostId, token: typeof data.token === 'string' ? data.token : undefined },
          this.env,
        );
        if (!auth.allowed) {
          ack({ error: auth.reason || 'ENTITLEMENT_REQUIRED' });
          return;
        }
        if (!this.consumeCreate(attachment.clientIp || 'unknown')) {
          ack({ error: 'RATE_LIMITED' });
          return;
        }

        try {
          const created = await this.createRoomForHost(
            hostId,
            attachment.socketId,
            typeof data.hostSecret === 'string' ? data.hostSecret : undefined,
            typeof data.createKey === 'string' ? data.createKey : undefined,
          );
          attachment.roomCode = created.roomCode;
          attachment.playerId = hostId;
          attachment.role = 'HOST';
          attachment.isHost = true;
          ws.serializeAttachment(attachment);
          ack(created);
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'ROOM_CREATE_FAILED';
          if (
            reason === 'ROOM_LIMIT' ||
            reason === 'ROOM_LIMIT_GLOBAL' ||
            reason === 'INVALID_HOST_ID' ||
            reason === 'INVALID_CREATE_KEY' ||
            reason === 'HOST_SECRET_REQUIRED'
          ) {
            ack({ error: reason });
          } else {
            throw error;
          }
        }
        return;
      }

      case 'joinRoom': {
        const code = normalizeRoomCode(data.roomCode);
        if (!code) {
          ack({ error: 'Room not found' });
          return;
        }
        if (attachment.roomCode && attachment.roomCode !== code) {
          ack({ error: 'ALREADY_IN_ROOM' });
          return;
        }

        const playerId = validatePlayerId(data.id);
        if (!playerId) {
          ack({ error: 'INVALID_PLAYER_ID' });
          return;
        }
        if (attachment.roomCode === code && attachment.playerId && attachment.playerId !== playerId) {
          // One socket owns one identity per room. This prevents a single
          // socket from filling the player/audience roster with ghost rows.
          ack({ error: 'ALREADY_IN_ROOM' });
          return;
        }
        if (!(await this.checkRoomExists(code))) {
          ack({ error: 'Room not found' });
          return;
        }

        const role = normalizeRole(data.role);
        const response = await this.roomFetch(code, '/internal/join', {
          playerId,
          role,
          name: sanitize(data.name, 12),
          socketId: attachment.socketId,
          hostSecret: normalizeSecret(data.hostSecret),
          playerSecret: normalizeSecret(data.playerSecret),
        });
        if (!response.ok) {
          const result = (await response.json().catch(() => ({}))) as { error?: string };
          ack({ error: result.error || 'Room not found' });
          return;
        }

        const result = (await response.json()) as {
          state?: unknown;
          becameHost?: boolean;
          playerSecret?: string;
        };
        const becameHost = result.becameHost === true;
        attachment.roomCode = code;
        attachment.playerId = playerId;
        attachment.role = becameHost ? 'HOST' : role === 'AUDIENCE' ? 'AUDIENCE' : 'PLAYER';
        attachment.isHost = becameHost;
        ws.serializeAttachment(attachment);
        this.touchRoom(code);
        ack({
          success: true,
          state: result.state ?? null,
          becameHost,
          playerSecret: result.playerSecret,
        });
        return;
      }

      case 'requestState': {
        const code = normalizeRoomCode(data.roomCode) || attachment.roomCode;
        if (!code || !attachment.roomCode || code !== attachment.roomCode) {
          ack(null);
          return;
        }
        const response = await this.roomFetch(code, '/internal/state', undefined, 'GET');
        if (!response.ok) {
          ack(null);
          return;
        }
        const result = (await response.json()) as { state?: unknown };
        ack(result.state ?? null);
        return;
      }

      case 'gameStateUpdate': {
        const code = normalizeRoomCode(data.roomCode) || attachment.roomCode;
        if (!code || !attachment.roomCode || code !== attachment.roomCode) return;
        const response = await this.roomFetch(code, '/internal/state-update', {
          gameState: data.gameState,
          playerId: attachment.playerId,
          socketId: attachment.socketId,
        });
        if (response.ok) {
          this.touchRoom(code);
        } else {
          // Fire-and-forget has no ack, so tell the host explicitly instead of
          // letting its state silently diverge from everyone else's.
          await this.notifyRoomError(ws, response, code);
        }
        return;
      }

      case 'hostEvent': {
        const code = normalizeRoomCode(data.roomCode) || attachment.roomCode;
        if (!code || !attachment.roomCode || code !== attachment.roomCode) return;
        const response = await this.roomFetch(code, '/internal/host-event', {
          event: data.event,
          playerId: attachment.playerId,
          socketId: attachment.socketId,
        });
        if (response.ok) this.touchRoom(code);
        return;
      }

      case 'playerEvent': {
        const code = normalizeRoomCode(data.roomCode) || attachment.roomCode;
        if (!code || !attachment.roomCode || code !== attachment.roomCode) return;
        if (!attachment.playerId) return;
        if (!isRecord(data.event) || !isPlayerEventType(data.event.type)) return;
        const response = await this.roomFetch(code, '/internal/player-event', {
          event: data.event,
          senderId: attachment.playerId,
          socketId: attachment.socketId,
        });
        if (response.ok) this.touchRoom(code);
        return;
      }

      case 'requestNarrator': {
        const code = normalizeRoomCode(data.roomCode) || attachment.roomCode;
        if (!code || !attachment.roomCode || code !== attachment.roomCode) return;
        const response = await this.roomFetch(code, '/internal/narrator', {
          text: sanitize(data.text, 500),
          language: data.language,
          requestId: data.requestId,
          playerId: attachment.playerId,
          socketId: attachment.socketId,
          clientIp: attachment.clientIp,
        });
        if (response.ok) this.touchRoom(code);
        return;
      }

      default:
        if (message.id) this.sendAck(ws, message.id, false, 'UNKNOWN_EVENT');
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.handleSocketGone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.handleSocketGone(ws);
  }

  private async handleSocketGone(ws: WebSocket): Promise<void> {
    const attachment = this.attachment(ws);
    if (!attachment?.roomCode) return;

    const { roomCode, playerId, socketId } = attachment;
    await this.roomFetch(roomCode, '/internal/disconnect', {
      playerId,
      role: attachment.role,
      socketId,
    });

    // Does this room still have any live socket? Closing the last one starts
    // the 60s empty-room grace (unless a host grace is already running).
    const remaining = this.ctx
      .getWebSockets()
      .filter((socket) => socket !== ws && this.attachment(socket)?.roomCode === roomCode);
    if (remaining.length === 0) {
      await this.roomFetch(roomCode, '/internal/empty', {});
    }
  }

  // ---------------------------------------------------------------------------
  // Room index / allocation
  // ---------------------------------------------------------------------------

  async createRoomForHost(
    rawHostId: string,
    hostSocketId: string,
    suppliedSecret?: string,
    rawCreateKey?: string,
  ): Promise<{ roomCode: string; hostSecret: string }> {
    const hostId = normalizeHostId(rawHostId);
    if (!hostId) throw new Error('INVALID_HOST_ID');
    const createKey = rawCreateKey === undefined ? '' : normalizeCreateKey(rawCreateKey);
    if (rawCreateKey !== undefined && !createKey) throw new Error('INVALID_CREATE_KEY');

    await this.sweepStaleRooms();
    await this.scheduleSweep();

    // Retrying a create whose ack was lost must return the same room and the
    // same secret, or the client strands the room and loses its identity.
    if (createKey) {
      const replay = this.rowForCreateKey(hostId, createKey);
      if (replay) {
        const supplied = normalizeSecret(suppliedSecret);
        const secret = supplied || (await this.deriveHostSecret(hostId, createKey));
        const hash = await hashSecret(secret);
        if (!replay.host_secret_hash || !timingSafeEqual(hash, replay.host_secret_hash)) {
          throw new Error('HOST_SECRET_REQUIRED');
        }
        return { roomCode: replay.code, hostSecret: secret };
      }
    }

    const totalRooms =
      this.ctx.storage.sql
        .exec<{ count: number }>('SELECT COUNT(*) AS count FROM rooms')
        .toArray()[0]?.count ?? 0;
    if (totalRooms >= maxTotalRooms(this.env)) throw new Error('ROOM_LIMIT_GLOBAL');

    let rows = this.rowsForHost(hostId);
    // Rooms indexed before host secrets existed have no hash and can never be
    // reclaimed. Drain them instead of blocking the host forever.
    const legacy = rows.filter((row) => !row.host_secret_hash);
    if (legacy.length > 0) {
      for (const row of legacy) await this.closeRoomRow(row.code, 'LEGACY_ROOM');
      rows = this.rowsForHost(hostId);
    }

    let hostSecret = normalizeSecret(suppliedSecret);
    let hostSecretHash = '';

    if (rows.length > 0) {
      // Every room for a host shares one server-issued secret. It is required
      // before createRoom may create, grace or close any of them.
      if (!hostSecret) throw new Error('HOST_SECRET_REQUIRED');
      const suppliedHash = await hashSecret(hostSecret);
      const match = rows.find(
        (row) => !!row.host_secret_hash && timingSafeEqual(suppliedHash, row.host_secret_hash),
      );
      if (!match) throw new Error('HOST_SECRET_REQUIRED');
      hostSecretHash = match.host_secret_hash;
    } else if (createKey) {
      // Deterministic first create: the same key can reproduce the secret
      // without storing the raw value.
      hostSecret = await this.deriveHostSecret(hostId, createKey);
      hostSecretHash = await hashSecret(hostSecret);
    } else {
      hostSecret = randomSecret();
      hostSecretHash = await hashSecret(hostSecret);
    }

    if (rows.length >= 3) {
      await this.closeRoomRow(rows[0].code, 'LIMIT_HARD_CAP');
      rows = this.rowsForHost(hostId);
    }

    const active = rows.filter((row) => row.pending_host_reconnect === 0);
    if (active.length >= MAX_CONCURRENT_ROOMS_PER_HOST) {
      await this.graceRoomRow(active[0].code, 'LIMIT_GRACE_EXPIRED');
    }

    for (let attempt = 0; attempt < 24; attempt++) {
      const code = randomRoomCode();
      if (this.getRow(code)) continue;

      const response = await this.roomFetch(code, '/internal/init', {
        roomCode: code,
        hostId,
        hostSocketId,
        hostSecretHash,
      });
      if (response.status === 200) {
        const now = Date.now();
        try {
          this.ctx.storage.sql.exec(
            `INSERT INTO rooms (code, host_id, host_secret_hash, created_at, last_seen, create_key, phase, player_count, pending_host_reconnect)
             VALUES (?, ?, ?, ?, ?, ?, 'LOBBY', 0, 0)`,
            code,
            hostId,
            hostSecretHash,
            now,
            now,
            createKey,
          );
          return { roomCode: code, hostSecret };
        } catch (error) {
          await this.roomFetch(code, '/internal/close', { reason: 'INDEX_INSERT_FAILED' });
          throw error;
        }
      }
      if (response.status === 409) continue;
      console.error('[Directory] room init failed', code, response.status, await response.text());
    }

    throw new Error('ROOM_CODE_ALLOCATION_FAILED');
  }

  async checkRoomExists(code: string): Promise<boolean> {
    if (!this.getRow(code)) return false;
    const info = await this.roomInfo(code);
    if (!info) {
      this.deleteRow(code);
      return false;
    }
    return true;
  }

  async roomsByHost(rawHostId: string, rawSecret?: unknown): Promise<RoomSummary[]> {
    const hostId = normalizeHostId(rawHostId);
    const hostSecret = normalizeSecret(rawSecret);
    if (!hostId || !hostSecret) return [];

    const rows = this.rowsForHost(hostId);
    if (rows.length === 0) return [];
    const suppliedHash = await hashSecret(hostSecret);
    if (!rows.some((row) => !!row.host_secret_hash && timingSafeEqual(suppliedHash, row.host_secret_hash))) {
      return [];
    }

    const summaries = await Promise.all(
      rows.map(async (row): Promise<RoomSummary | null> => {
        const info = await this.roomInfo(row.code);
        if (!info) {
          this.deleteRow(row.code);
          return null;
        }
        return {
          roomCode: row.code,
          phase: info.phase,
          playerCount: info.playerCount,
          playerNames: info.playerNames,
          isGracePeriod: info.pendingHostReconnect,
          createdAt: info.createdAt || row.created_at,
        };
      }),
    );

    return summaries.filter((summary): summary is RoomSummary => summary !== null);
  }

  private rowsForHost(hostId: string): RoomRow[] {
    return this.ctx.storage.sql
      .exec<RoomRow>(
        'SELECT ' + ROOM_COLUMNS + ' FROM rooms WHERE host_id = ? ORDER BY created_at ASC',
        hostId,
      )
      .toArray();
  }

  private rowForCreateKey(hostId: string, createKey: string): RoomRow | null {
    return (
      this.ctx.storage.sql
        .exec<RoomRow>(
          'SELECT ' + ROOM_COLUMNS + ' FROM rooms WHERE host_id = ? AND create_key = ? ORDER BY created_at ASC LIMIT 1',
          hostId,
          createKey,
        )
        .toArray()[0] ?? null
    );
  }

  /** Directory-local pepper; never leaves the DO or the server. */
  private hostPepper(): string {
    const row = this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM meta WHERE key = 'host_secret_pepper'")
      .toArray()[0];
    if (row?.value) return row.value;
    const pepper = randomSecret();
    this.ctx.storage.sql.exec(
      "INSERT INTO meta (key, value) VALUES ('host_secret_pepper', ?)",
      pepper,
    );
    return pepper;
  }

  /**
   * Deterministic first-room secret for an idempotent create. Only the
   * Directory can reproduce it, and only from the client's create key.
   */
  private async deriveHostSecret(hostId: string, createKey: string): Promise<string> {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(this.hostPepper()),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`${hostId}:${createKey}`),
    );
    return Array.from(new Uint8Array(signature).slice(0, 16), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
  }

  /** Mark a room active, at most once a minute per room. */
  private touchRoom(code: string): void {
    const now = Date.now();
    this.ctx.storage.sql.exec(
      'UPDATE rooms SET last_seen = ? WHERE code = ? AND last_seen < ?',
      now,
      code,
      now - 60_000,
    );
  }

  /** Tell the sending host that the room refused a fire-and-forget update. */
  private async notifyRoomError(ws: WebSocket, response: Response, roomCode: string): Promise<void> {
    let error = 'ROOM_ERROR';
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === 'string') error = body.error;
    } catch {
      // Keep the generic code.
    }
    try {
      ws.send(JSON.stringify({ event: 'roomError', data: { error, roomCode } }));
    } catch {
      // Socket already closing.
    }
  }

  private getRow(code: string): RoomRow | null {
    const row = this.ctx.storage.sql
      .exec<RoomRow>(
        'SELECT ' + ROOM_COLUMNS + ' FROM rooms WHERE code = ?',
        code,
      )
      .toArray()[0];
    return row ?? null;
  }

  private deleteRow(code: string): void {
    this.ctx.storage.sql.exec('DELETE FROM rooms WHERE code = ?', code);
  }

  private updateRow(code: string, fields: Partial<Pick<RoomRow, 'phase' | 'player_count' | 'pending_host_reconnect'>>): void {
    const row = this.getRow(code);
    if (!row) return;
    this.ctx.storage.sql.exec(
      'UPDATE rooms SET phase = ?, player_count = ?, pending_host_reconnect = ? WHERE code = ?',
      fields.phase ?? row.phase,
      fields.player_count ?? row.player_count,
      fields.pending_host_reconnect ?? row.pending_host_reconnect,
      code,
    );
  }

  private async roomInfo(code: string): Promise<RoomInfo | null> {
    const response = await this.roomFetch(code, '/internal/info', undefined, 'GET');
    if (!response.ok) return null;
    const info = (await response.json()) as RoomInfo;
    return info?.exists ? info : null;
  }

  private async closeRoomRow(code: string, reason: string): Promise<void> {
    const response = await this.roomFetch(code, '/internal/close', { reason });
    // A live room deletes its own index row via /internal/room-closed. A dead
    // or missing room cannot, so sweep the row here.
    if (!response.ok || this.getRow(code)) {
      this.deleteRow(code);
      await this.closeSocketsForRoom(code);
    }
  }

  private async graceRoomRow(code: string, reason: string): Promise<void> {
    const response = await this.roomFetch(code, '/internal/grace', { reason });
    if (response.ok) {
      this.updateRow(code, { pending_host_reconnect: 1 });
    } else {
      this.deleteRow(code);
      await this.closeSocketsForRoom(code);
    }
  }

  private async sweepStaleRooms(): Promise<void> {
    const now = Date.now();
    const cutoff = now - SIX_HOURS;
    const stale = this.ctx.storage.sql
      .exec<{ code: string; host_secret_hash: string }>(
        'SELECT code, host_secret_hash FROM rooms WHERE host_secret_hash = ? OR last_seen < ?',
        '',
        cutoff,
      )
      .toArray();
    for (const row of stale) {
      // Legacy rows have no recoverable secret. Idle rooms are reaped even if
      // a socket still lingers: last_seen only moves when the room is active.
      await this.closeRoomRow(row.code, row.host_secret_hash ? 'STALE_ROOM' : 'LEGACY_ROOM');
    }
    this.ctx.storage.sql.exec(
      'DELETE FROM rate_limits WHERE window_start < ?',
      now - CREATE_WINDOW * 2,
    );
  }

  /** Keep one sweep alarm regardless of how many creates happen. */
  private async scheduleSweep(): Promise<void> {
    try {
      if ((await this.ctx.storage.getAlarm()) === null) {
        await this.ctx.storage.setAlarm(Date.now() + SIX_HOURS);
      }
    } catch (error) {
      console.warn('[Directory] could not schedule sweep alarm', error);
    }
  }

  async alarm(): Promise<void> {
    await this.sweepStaleRooms();
    await this.scheduleSweep();
  }

  private consumeCreate(ip: string): boolean {
    const now = Date.now();
    const key = `create:${ip}`;
    // Durable so an eviction/restart cannot reset the per-IP create budget.
    const row = this.ctx.storage.sql
      .exec<{ window_start: number; count: number }>(
        'SELECT window_start, count FROM rate_limits WHERE key = ?',
        key,
      )
      .toArray()[0];
    const result = consumeRate(
      row ? { count: row.count, windowStart: row.window_start } : { count: 0, windowStart: now },
      now,
      maxCreatesPerHour(this.env),
      CREATE_WINDOW,
    );
    this.ctx.storage.sql.exec(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = excluded.count`,
      key,
      result.next.windowStart,
      result.next.count,
    );
    return !result.limited;
  }

  private async roomFetch(
    code: string,
    path: string,
    body?: unknown,
    method: 'GET' | 'POST' = 'POST',
  ): Promise<Response> {
    try {
      const id = this.env.ROOMS.idFromName(code);
      const stub = this.env.ROOMS.get(id);
      return await stub.fetch(`https://room${path}`, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      console.error('[Directory] room RPC failed', code, path, error);
      return new Response(null, { status: 503 });
    }
  }

  // ---------------------------------------------------------------------------
  // Internal RPC from BambooRoom
  // ---------------------------------------------------------------------------

  private async internalBroadcast(request: Request): Promise<Response> {
    const body = await readJson(request);
    const roomCode = sanitize(body.roomCode, 4).toUpperCase();
    const event = sanitize(body.event, 64);
    if (!roomCode || !event) return json({ error: 'INVALID_BROADCAST' }, 400);

    const data = body.data;
    const onlySocketId = sanitize(body.onlySocketId, 128);
    const excludeSocketId = sanitize(body.excludeSocketId, 128);
    const frame = JSON.stringify(data === undefined ? { event } : { event, data });
    if (new TextEncoder().encode(frame).byteLength > MAX_FRAME_BYTES) {
      console.warn('[Directory] dropped oversized broadcast', event, roomCode);
      return json({ error: 'FRAME_TOO_LARGE' }, 413);
    }

    for (const socket of this.ctx.getWebSockets()) {
      const attachment = this.attachment(socket);
      if (!attachment || attachment.roomCode !== roomCode) continue;
      if (onlySocketId && attachment.socketId !== onlySocketId) continue;
      if (excludeSocketId && attachment.socketId === excludeSocketId) continue;
      try {
        socket.send(frame);
      } catch {
        // A closing socket must not block the rest of the broadcast.
      }
    }
    return json({ ok: true });
  }

  private async internalRoomClosed(request: Request): Promise<Response> {
    const body = await readJson(request);
    const roomCode = sanitize(body.roomCode, 4).toUpperCase();
    if (!roomCode) return json({ error: 'INVALID_ROOM' }, 400);

    this.deleteRow(roomCode);
    const frame = JSON.stringify({ event: 'roomClosed' });
    for (const socket of this.ctx.getWebSockets()) {
      if (this.attachment(socket)?.roomCode !== roomCode) continue;
      try {
        socket.send(frame);
        socket.close(1000, 'room closed');
      } catch {
        // Already gone.
      }
    }
    return json({ ok: true });
  }

  private async internalRoomMeta(request: Request): Promise<Response> {
    const body = await readJson(request);
    const roomCode = sanitize(body.roomCode, 4).toUpperCase();
    if (!roomCode) return json({ error: 'INVALID_ROOM' }, 400);

    const fields: Partial<Pick<RoomRow, 'phase' | 'player_count' | 'pending_host_reconnect'>> = {};
    if (typeof body.phase === 'string') fields.phase = sanitize(body.phase, 40);
    if (typeof body.playerCount === 'number') fields.player_count = body.playerCount;
    if (typeof body.pendingHostReconnect === 'boolean') {
      fields.pending_host_reconnect = body.pendingHostReconnect ? 1 : 0;
    }
    this.updateRow(roomCode, fields);
    this.touchRoom(roomCode);
    return json({ ok: true });
  }

  private async internalTtsRequest(request: Request): Promise<Response> {
    const body = await readJson(request);
    const ip = sanitize(body.ip, 64) || 'unknown';
    const globalKey = 'req:global';
    const ipKey = `req:ip:${ip}`;
    const day = new Date().toISOString().slice(0, 10);
    const globalCount = this.budgetCount(globalKey, day);
    const ipCount = this.budgetCount(ipKey, day);
    const globalLimit = ttsDailyRequests(this.env);
    const ipLimit = ttsIpDailyRequests(this.env);
    if (globalCount + 1 > globalLimit || ipCount + 1 > ipLimit) {
      return json(
        {
          allowed: false,
          error: 'TTS_RATE_EXCEEDED',
          global: globalCount,
          ip: ipCount,
          globalLimit,
          ipLimit,
        },
        429,
      );
    }
    this.budgetAdd(globalKey, day, globalCount + 1);
    this.budgetAdd(ipKey, day, ipCount + 1);
    return json({
      allowed: true,
      global: globalCount + 1,
      ip: ipCount + 1,
      globalLimit,
      ipLimit,
    });
  }

  private async internalTtsBudget(request: Request): Promise<Response> {
    const body = await readJson(request);
    const ip = sanitize(body.ip, 64) || 'unknown';
    const chars = Math.floor(Number(body.chars));
    if (!Number.isFinite(chars) || chars <= 0) {
      return json({ error: 'INVALID_CHARS' }, 400);
    }

    const day = new Date().toISOString().slice(0, 10);
    const globalKey = 'global';
    const ipKey = `ip:${ip}`;
    const globalCount = this.budgetCount(globalKey, day);
    const ipCount = this.budgetCount(ipKey, day);
    const globalLimit = ttsDailyChars(this.env);
    const ipLimit = ttsIpDailyChars(this.env);

    if (globalCount + chars > globalLimit || ipCount + chars > ipLimit) {
      return json(
        {
          allowed: false,
          error: 'TTS_BUDGET_EXCEEDED',
          global: globalCount,
          ip: ipCount,
          globalLimit,
          ipLimit,
        },
        429,
      );
    }

    this.budgetAdd(globalKey, day, globalCount + chars);
    this.budgetAdd(ipKey, day, ipCount + chars);
    return json({
      allowed: true,
      global: globalCount + chars,
      ip: ipCount + chars,
      globalLimit,
      ipLimit,
    });
  }

  private budgetCount(key: string, day: string): number {
    const row = this.ctx.storage.sql
      .exec<{ day: string; count: number }>('SELECT day, count FROM tts_budget WHERE key = ?', key)
      .toArray()[0];
    if (!row) return 0;
    if (row.day !== day) {
      this.ctx.storage.sql.exec('DELETE FROM tts_budget WHERE key = ?', key);
      return 0;
    }
    return row.count;
  }

  private budgetAdd(key: string, day: string, count: number): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO tts_budget (key, day, count) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET day = excluded.day, count = excluded.count`,
      key,
      day,
      count,
    );
  }

  private async internalDemote(request: Request): Promise<Response> {
    const body = await readJson(request);
    const socketId = sanitize(body.socketId, 128);
    if (!socketId) return json({ ok: true });
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = this.attachment(socket);
      if (attachment?.socketId === socketId) {
        attachment.isHost = false;
        socket.serializeAttachment(attachment);
      }
    }
    return json({ ok: true });
  }

  private async internalCloseSocket(request: Request): Promise<Response> {
    const body = await readJson(request);
    const socketId = sanitize(body.socketId, 128);
    if (!socketId) return json({ ok: true });
    for (const socket of this.ctx.getWebSockets()) {
      if (this.attachment(socket)?.socketId !== socketId) continue;
      try {
        socket.close(4001, 'player resumed on another socket');
      } catch {
        // Already gone.
      }
    }
    return json({ ok: true });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private attachment(ws: WebSocket): SocketAttachment | null {
    try {
      const attachment = ws.deserializeAttachment() as SocketAttachment | null;
      if (!attachment || typeof attachment.socketId !== 'string') return null;
      return attachment;
    } catch {
      return null;
    }
  }

  private sendAck(ws: WebSocket, id: string, ok: boolean, value: unknown): void {
    const ack: ServerAck = ok
      ? { id, ok: true, data: value }
      : { id, ok: false, error: typeof value === 'string' ? value : 'ERROR' };
    try {
      ws.send(JSON.stringify(ack));
    } catch {
      // Socket closed mid-ack.
    }
  }

  private async closeSocketsForRoom(roomCode: string): Promise<void> {
    const frame = JSON.stringify({ event: 'roomClosed' });
    for (const socket of this.ctx.getWebSockets()) {
      if (this.attachment(socket)?.roomCode !== roomCode) continue;
      try {
        socket.send(frame);
        socket.close(1000, 'room closed');
      } catch {
        // Already gone.
      }
    }
  }
}

function randomRoomCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join('');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
