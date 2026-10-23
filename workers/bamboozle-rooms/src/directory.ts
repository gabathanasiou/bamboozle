import type { Env } from './env';
import { authorizeHost } from './auth';
import {
  MAX_CONCURRENT_ROOMS_PER_HOST,
  RATE_LIMITED_EVENTS,
  READ_EVENTS,
  consumeRate,
  hashHostSecret,
  isPlayerEventType,
  normalizeHostId,
  normalizeHostSecret,
  normalizeRoomCode,
  normalizeRole,
  parseClientMessage,
  randomHostSecret,
  sanitize,
  timingSafeEqual,
  validatePlayerId,
  type RateState,
  type ServerAck,
  type SocketAttachment,
} from './protocol';

const SIX_HOURS = 6 * 60 * 60 * 1000;

interface RoomRow {
  [key: string]: string | number | null;
  code: string;
  host_id: string;
  host_secret_hash: string;
  created_at: number;
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
        phase TEXT NOT NULL DEFAULT 'LOBBY',
        player_count INTEGER NOT NULL DEFAULT 0,
        pending_host_reconnect INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS rooms_by_host ON rooms(host_id);
      CREATE INDEX IF NOT EXISTS rooms_by_created ON rooms(created_at);
    `);
    // Existing deployments predate the host-secret column.
    try {
      this.ctx.storage.sql.exec("ALTER TABLE rooms ADD COLUMN host_secret_hash TEXT NOT NULL DEFAULT ''");
    } catch {
      // Column already exists.
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/ws') return this.handleWebSocket(request);
      if (url.pathname === '/internal/broadcast') return await this.internalBroadcast(request);
      if (url.pathname === '/internal/room-closed') return await this.internalRoomClosed(request);
      if (url.pathname === '/internal/room-meta') return await this.internalRoomMeta(request);
      if (url.pathname === '/internal/demote') return await this.internalDemote(request);
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
      clientIp:
        (request.headers.get('cf-connecting-ip') ||
          request.headers.get('x-real-ip') ||
          request.headers.get('x-forwarded-for') ||
          '')
          .split(',')[0]
          .trim()
          .slice(0, 64),
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
        const ipRate = consumeRate(this.ipRates.get(ipKey) ?? { count: 0, windowStart: now }, now);
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
        ack(hostId ? await this.roomsByHost(hostId) : []);
        return;
      }

      case 'createRoom': {
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

        try {
          const created = await this.createRoomForHost(
            hostId,
            attachment.socketId,
            typeof data.hostSecret === 'string' ? data.hostSecret : undefined,
          );
          attachment.roomCode = created.roomCode;
          attachment.playerId = hostId;
          attachment.role = 'HOST';
          attachment.isHost = true;
          ws.serializeAttachment(attachment);
          ack(created);
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'ROOM_CREATE_FAILED';
          if (reason === 'ROOM_LIMIT' || reason === 'INVALID_HOST_ID' || reason === 'HOST_SECRET_REQUIRED') {
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
          hostSecret: normalizeHostSecret(data.hostSecret),
        });
        if (!response.ok) {
          const result = (await response.json().catch(() => ({}))) as { error?: string };
          ack({ error: result.error || 'Room not found' });
          return;
        }

        const result = (await response.json()) as {
          state?: unknown;
          becameHost?: boolean;
        };
        const becameHost = result.becameHost === true;
        attachment.roomCode = code;
        attachment.playerId = playerId;
        attachment.role = becameHost ? 'HOST' : role === 'AUDIENCE' ? 'AUDIENCE' : 'PLAYER';
        attachment.isHost = becameHost;
        ws.serializeAttachment(attachment);
        ack({ success: true, state: result.state ?? null, becameHost });
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
        await this.roomFetch(code, '/internal/state-update', {
          gameState: data.gameState,
          playerId: attachment.playerId,
          socketId: attachment.socketId,
        });
        return;
      }

      case 'hostEvent': {
        const code = normalizeRoomCode(data.roomCode) || attachment.roomCode;
        if (!code || !attachment.roomCode || code !== attachment.roomCode) return;
        await this.roomFetch(code, '/internal/host-event', {
          event: data.event,
          playerId: attachment.playerId,
          socketId: attachment.socketId,
        });
        return;
      }

      case 'playerEvent': {
        const code = normalizeRoomCode(data.roomCode) || attachment.roomCode;
        if (!code || !attachment.roomCode || code !== attachment.roomCode) return;
        if (!attachment.playerId) return;
        if (!isRecord(data.event) || !isPlayerEventType(data.event.type)) return;
        await this.roomFetch(code, '/internal/player-event', {
          event: data.event,
          senderId: attachment.playerId,
          socketId: attachment.socketId,
        });
        return;
      }

      case 'requestNarrator': {
        const code = normalizeRoomCode(data.roomCode) || attachment.roomCode;
        if (!code || !attachment.roomCode || code !== attachment.roomCode) return;
        await this.roomFetch(code, '/internal/narrator', {
          text: sanitize(data.text, 500),
          language: data.language,
          requestId: data.requestId,
          playerId: attachment.playerId,
          socketId: attachment.socketId,
        });
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
  ): Promise<{ roomCode: string; hostSecret: string }> {
    const hostId = normalizeHostId(rawHostId);
    if (!hostId) throw new Error('INVALID_HOST_ID');

    await this.sweepStaleRooms();

    let rows = this.rowsForHost(hostId);
    let hostSecret = normalizeHostSecret(suppliedSecret);
    let hostSecretHash = '';

    if (rows.length > 0) {
      // Every room for a host shares one server-issued secret. It is required
      // before createRoom may create, grace or close any of them.
      if (!hostSecret) throw new Error('HOST_SECRET_REQUIRED');
      const suppliedHash = await hashHostSecret(hostSecret);
      const match = rows.find(
        (row) => !!row.host_secret_hash && timingSafeEqual(suppliedHash, row.host_secret_hash),
      );
      if (!match) throw new Error('HOST_SECRET_REQUIRED');
      hostSecretHash = match.host_secret_hash;
    } else {
      hostSecret = randomHostSecret();
      hostSecretHash = await hashHostSecret(hostSecret);
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
        try {
          this.ctx.storage.sql.exec(
            `INSERT INTO rooms (code, host_id, host_secret_hash, created_at, phase, player_count, pending_host_reconnect)
             VALUES (?, ?, ?, ?, 'LOBBY', 0, 0)`,
            code,
            hostId,
            hostSecretHash,
            Date.now(),
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

  async roomsByHost(rawHostId: string): Promise<RoomSummary[]> {
    const hostId = normalizeHostId(rawHostId);
    if (!hostId) return [];

    const rows = this.rowsForHost(hostId);
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
        'SELECT code, host_id, host_secret_hash, created_at, phase, player_count, pending_host_reconnect FROM rooms WHERE host_id = ? ORDER BY created_at ASC',
        hostId,
      )
      .toArray();
  }

  private getRow(code: string): RoomRow | null {
    const row = this.ctx.storage.sql
      .exec<RoomRow>(
        'SELECT code, host_id, host_secret_hash, created_at, phase, player_count, pending_host_reconnect FROM rooms WHERE code = ?',
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
    const cutoff = Date.now() - SIX_HOURS;
    const stale = this.ctx.storage.sql
      .exec<{ code: string }>('SELECT code FROM rooms WHERE created_at < ?', cutoff)
      .toArray();
    for (const row of stale) {
      await this.closeRoomRow(row.code, 'STALE_ROOM');
    }
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
    return json({ ok: true });
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
