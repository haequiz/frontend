import { Client, type IMessage, type StompSubscription } from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import { API_URL } from './config';

/* ------------------------------------------------------------------
 * 실시간 연결 (STOMP over WebSocket, 막히면 SockJS 가 HTTP 스트리밍 · 폴링으로 바꾼다)
 *   요청: /app/{type} + request-id 헤더 → 응답 /user/queue/reply { requestId, ok, data, error }
 *   이벤트: { type, pin, data } — 구독한 주소에서 type 별로 나눠 준다
 * 연결이 끊기면 2초 뒤 다시 붙고, 구독을 되살린 뒤 onReconnect 로 알린다 (화면은 그때 상태를 다시 받는다)
 * ------------------------------------------------------------------ */

export interface GameEvent<T = unknown> {
  type: string;
  pin: string | null;
  data: T;
}

type Handler = (data: any, event: GameEvent) => void;

interface Pending {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: number;
}

let seq = 0;

export class Realtime {
  private client: Client;
  private destinations = new Set<string>();
  private active = new Map<string, StompSubscription>();
  private handlers = new Map<string, Set<Handler>>();
  private pending = new Map<string, Pending>();
  private waiters: (() => void)[] = [];
  private everConnected = false;

  /** 연결 상태가 바뀔 때 */
  onStatus?: (connected: boolean) => void;
  /** 끊겼다가 다시 붙었을 때 (처음 연결은 제외) */
  onReconnect?: () => void;
  /** 토큰 만료 · 위조로 연결이 거부됐을 때 */
  onAuthError?: () => void;

  constructor(token?: string | null) {
    this.client = new Client({
      webSocketFactory: () => new SockJS(`${API_URL}/ws`),
      connectHeaders: token ? { Authorization: `Bearer ${token}` } : {},
      reconnectDelay: 2000,
      heartbeatIncoming: 10_000,
      heartbeatOutgoing: 10_000,
      onConnect: () => {
        this.active.clear();
        this.subscribeNow('/user/queue/reply');
        this.destinations.forEach(d => this.subscribeNow(d));
        this.onStatus?.(true);
        this.waiters.splice(0).forEach(w => w());
        if (this.everConnected) this.onReconnect?.();
        this.everConnected = true;
      },
      onWebSocketClose: () => this.onStatus?.(false),
      onStompError: frame => {
        const msg = frame.headers.message || '';
        if (/jwt|token|운영자|expired|denied/i.test(msg)) this.onAuthError?.();
      },
    });
  }

  start() {
    this.client.activate();
  }

  stop() {
    this.pending.forEach(p => {
      clearTimeout(p.timer);
      p.reject(new Error('연결을 닫았습니다.'));
    });
    this.pending.clear();
    return this.client.deactivate();
  }

  get connected() {
    return this.client.connected;
  }

  /** 다시 연결돼도 유지되는 구독 */
  subscribe(destination: string) {
    if (this.destinations.has(destination)) return;
    this.destinations.add(destination);
    if (this.client.connected) this.subscribeNow(destination);
  }

  unsubscribe(destination: string) {
    this.destinations.delete(destination);
    this.active.get(destination)?.unsubscribe();
    this.active.delete(destination);
  }

  on<T = any>(type: string, handler: (data: T, event: GameEvent<T>) => void): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler as Handler);
    return () => this.handlers.get(type)?.delete(handler as Handler);
  }

  /** 요청을 보내고 응답(data)을 받는다. 연결 전이면 연결될 때까지 기다린다 */
  async request<T = any>(type: string, body: object = {}, timeoutMs = 15_000): Promise<T> {
    if (!this.client.connected) {
      await new Promise<void>(res => this.waiters.push(res));
    }
    const id = `r${++seq}`;
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('서버 응답이 없습니다. 잠시 후 다시 시도해 주세요.'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.client.publish({
        destination: `/app/${type}`,
        headers: { 'request-id': id },
        body: JSON.stringify(body),
      });
    });
  }

  private subscribeNow(destination: string) {
    this.active.set(destination, this.client.subscribe(destination, (m: IMessage) => this.dispatch(m)));
  }

  private dispatch(m: IMessage) {
    const msg = JSON.parse(m.body);
    if ('requestId' in msg) {
      const p = this.pending.get(msg.requestId);
      if (!p) return;
      this.pending.delete(msg.requestId);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.data);
      else p.reject(new Error(msg.error || '요청을 처리하지 못했습니다.'));
      return;
    }
    const event = msg as GameEvent;
    this.handlers.get(event.type)?.forEach(h => h(event.data, event));
  }
}
