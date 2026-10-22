/**
 * Native-WebSocket adapter for the bamboozle-rooms Worker.
 *
 * It keeps the small Socket.IO surface gameService.ts already uses:
 *   on(event, cb) -> unsubscribe
 *   emit(event, data) / emit(event, data, ack)
 *   emitAck(event, data) -> Promise
 *
 * Wire envelope (workers/bamboozle-rooms/src/protocol.ts):
 *   C→S { id?, event, data? }
 *   S→C { id, ok: true, data } | { id, ok: false, error }
 *   S→C { event, data? }
 */

export const ACK_TIMEOUT_MS = 10_000;
export const MAX_QUEUED_EMITS = 50;

export type RealtimeListener = (data?: unknown) => void;
export type RealtimeAck = (data?: unknown) => void;

interface PendingAck {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface QueuedEmit {
  event: string;
  data?: unknown;
  id?: string;
}

export class RealtimeClient {
  connected = false;
  id = '';

  private socket: WebSocket | null = null;
  private targetUrl = '';
  private manualClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private listeners = new Map<string, Set<RealtimeListener>>();
  private pending = new Map<string, PendingAck>();
  private queue: QueuedEmit[] = [];

  connect(url: string): void {
    const nextUrl = toWebSocketUrl(url);
    if (this.socket && this.targetUrl === nextUrl && !this.manualClose) return;

    this.clearReconnect();
    this.manualClose = false;
    this.targetUrl = nextUrl;
    this.closeSocket();
    this.open();
  }

  on(event: string, listener: RealtimeListener): () => void {
    let listeners = this.listeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(event, listeners);
    }
    listeners.add(listener);
    return () => {
      const current = this.listeners.get(event);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(event);
    };
  }

  emit(event: string, data?: unknown, ack?: RealtimeAck): void {
    if (ack) {
      void this.emitAck(event, data)
        .then((response) => ack(response))
        .catch((error: Error) => {
          console.warn(`[Realtime] ${event} ack failed: ${error.message}`);
        });
      return;
    }

    if (this.connected && this.socket) this.send({ event, data });
    else this.enqueue({ event, data });
  }

  emitAck<T = unknown>(event: string, data?: unknown, timeoutMs = ACK_TIMEOUT_MS): Promise<T> {
    const id = makeId();
    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('ACK_TIMEOUT'));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
    });

    if (this.connected && this.socket) this.send({ event, data, id });
    else this.enqueue({ event, data, id });

    return promise;
  }

  disconnect(): void {
    this.manualClose = true;
    this.clearReconnect();
    this.rejectAll(new Error('DISCONNECTED'));
    this.queue = [];
    this.closeSocket();
    this.setConnected(false, 'io client disconnect');
  }

  // ---------------------------------------------------------------------------

  private open(): void {
    if (!this.targetUrl || this.manualClose) return;

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.targetUrl);
    } catch (error) {
      this.emitLocal('connect_error', error instanceof Error ? error : new Error(String(error)));
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.addEventListener('open', () => {
      if (this.socket !== socket) return;
      this.reconnectAttempts = 0;
      this.id = makeId();
      this.setConnected(true, undefined);
      this.flushQueue();
    });

    socket.addEventListener('message', (event) => {
      if (this.socket !== socket) return;
      this.handleMessage(event.data);
    });

    socket.addEventListener('error', () => {
      if (this.socket !== socket) return;
      this.emitLocal('connect_error', new Error('WebSocket error'));
    });

    socket.addEventListener('close', (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.id = '';
      this.rejectAll(new Error('DISCONNECTED'));
      this.queue = [];
      this.setConnected(false, event.reason || 'transport close');
      if (!this.manualClose) this.scheduleReconnect();
    });
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    if (!message || typeof message !== 'object') return;

    if (typeof message.id === 'string') {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.ok === true) pending.resolve(message.data);
      else pending.reject(new Error(typeof message.error === 'string' ? message.error : 'ACK_ERROR'));
      return;
    }

    if (typeof message.event === 'string') this.emitLocal(message.event, message.data);
  }

  private send(payload: QueuedEmit): void {
    if (!this.socket) return;
    try {
      this.socket.send(JSON.stringify(payload));
    } catch {
      // The close handler will reconnect.
    }
  }

  private flushQueue(): void {
    const queued = this.queue;
    this.queue = [];
    for (const entry of queued) this.send(entry);
  }

  private enqueue(entry: QueuedEmit): void {
    if (this.queue.length >= MAX_QUEUED_EMITS) {
      const dropped = this.queue.shift();
      if (dropped?.id) this.rejectPending(dropped.id, new Error('QUEUE_OVERFLOW'));
    }
    this.queue.push(entry);
  }

  private scheduleReconnect(): void {
    if (this.manualClose || this.reconnectTimer) return;
    const base = Math.min(8000, 500 * 2 ** this.reconnectAttempts);
    const jitter = Math.random() * 250;
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, base + jitter);
  }

  private clearReconnect(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private closeSocket(): void {
    if (!this.socket) return;
    const socket = this.socket;
    this.socket = null;
    try {
      socket.close();
    } catch {
      // Already closed.
    }
  }

  private setConnected(value: boolean, reason: string | undefined): void {
    if (this.connected === value) return;
    this.connected = value;
    if (value) this.emitLocal('connect');
    else this.emitLocal('disconnect', reason);
  }

  private emitLocal(event: string, data?: unknown): void {
    const listeners = this.listeners.get(event);
    if (!listeners) return;
    for (const listener of listeners) {
      try {
        listener(data);
      } catch (error) {
        console.error(`[Realtime] listener for ${event} failed`, error);
      }
    }
  }

  private rejectPending(id: string, error: Error): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.reject(error);
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

export function toWebSocketUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  const url = new URL(trimmed);
  url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:';
  if (!/\/ws$/.test(url.pathname)) {
    url.pathname = `${url.pathname.replace(/\/$/, '')}/ws`;
  }
  return url.toString();
}

function makeId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `r-${uuid ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`;
}
