import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealtimeClient, toWebSocketUrl } from './realtimeClient';

type Handler = (event: any) => void;

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  sent: Array<Record<string, unknown>> = [];
  private handlers = new Map<string, Set<Handler>>();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, handler: Handler) {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
  }

  send(raw: string) {
    this.sent.push(JSON.parse(raw));
  }

  close() {
    this.emit('close', { reason: '' });
  }

  serverClose(reason = 'transport close') {
    this.emit('close', { reason });
  }

  open() {
    this.emit('open', {});
  }

  receive(message: unknown) {
    this.emit('message', { data: JSON.stringify(message) });
  }

  private emit(type: string, event: unknown) {
    for (const handler of this.handlers.get(type) ?? []) handler(event);
  }
}

describe('RealtimeClient', () => {
  let originalWebSocket: typeof WebSocket;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    globalThis.WebSocket = originalWebSocket;
  });

  it('converts http(s) server URLs to ws(s) /ws', () => {
    expect(toWebSocketUrl('http://localhost:8787')).toBe('ws://localhost:8787/ws');
    expect(toWebSocketUrl('https://bamboozle-rooms.example.workers.dev/')).toBe(
      'wss://bamboozle-rooms.example.workers.dev/ws',
    );
    expect(toWebSocketUrl('wss://example.test/custom')).toBe('wss://example.test/custom/ws');
  });

  it('queues emits while connecting and flushes on open', () => {
    const client = new RealtimeClient();
    client.connect('http://localhost:8787');
    client.emit('checkRoom', { roomCode: 'ABCD' });

    const socket = MockWebSocket.instances[0];
    expect(socket.sent).toEqual([]);
    socket.open();

    expect(client.connected).toBe(true);
    expect(socket.sent).toEqual([{ event: 'checkRoom', data: { roomCode: 'ABCD' } }]);
  });

  it('resolves an ack by id', async () => {
    const client = new RealtimeClient();
    client.connect('http://localhost:8787');
    const socket = MockWebSocket.instances[0];
    socket.open();

    const promise = client.emitAck<{ success: boolean }>('joinRoom', { roomCode: 'ABCD' });
    const sent = socket.sent.at(-1)!;
    expect(sent.event).toBe('joinRoom');
    expect(typeof sent.id).toBe('string');

    socket.receive({ id: sent.id, ok: true, data: { success: true } });
    await expect(promise).resolves.toEqual({ success: true });
  });

  it('rejects an error ack', async () => {
    const client = new RealtimeClient();
    client.connect('http://localhost:8787');
    const socket = MockWebSocket.instances[0];
    socket.open();

    const promise = client.emitAck('createRoom', { hostId: 'h' });
    const sent = socket.sent.at(-1)!;
    socket.receive({ id: sent.id, ok: false, error: 'RATE_LIMITED' });
    await expect(promise).rejects.toThrow('RATE_LIMITED');
  });

  it('dispatches pushes and returns an unsubscribe', () => {
    const client = new RealtimeClient();
    const received: unknown[] = [];
    const off = client.on('playAudio', (data) => received.push(data));
    client.connect('http://localhost:8787');
    const socket = MockWebSocket.instances[0];
    socket.open();

    socket.receive({ event: 'playAudio', data: { audioUrl: 'https://audio' } });
    expect(received).toEqual([{ audioUrl: 'https://audio' }]);

    off();
    socket.receive({ event: 'playAudio', data: { audioUrl: 'https://audio2' } });
    expect(received).toHaveLength(1);
  });

  it('rejects pending acks and reconnects the room after a transport close', async () => {
    vi.useFakeTimers();
    const client = new RealtimeClient();
    client.connect('http://localhost:8787');
    const socket = MockWebSocket.instances[0];
    socket.open();

    const pending = client.emitAck('joinRoom', { roomCode: 'ABCD' });
    socket.serverClose();

    await expect(pending).rejects.toThrow('DISCONNECTED');
    expect(client.connected).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(MockWebSocket.instances[1].url).toBe('ws://localhost:8787/ws');
  });

  it('does not reconnect after an explicit disconnect', () => {
    vi.useFakeTimers();
    const client = new RealtimeClient();
    client.connect('http://localhost:8787');
    MockWebSocket.instances[0].open();
    client.disconnect();

    vi.advanceTimersByTime(10000);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(client.connected).toBe(false);
  });
});
