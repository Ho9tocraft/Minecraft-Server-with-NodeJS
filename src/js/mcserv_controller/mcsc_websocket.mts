import { randomBytes } from 'crypto';
import { WebSocket } from 'ws';

const TicketLifetimeMs = 30 * 1000;
const MaxPendingTickets = 256;

type TicketRecord = Readonly<{
  sessionId: string,
  username: string,
  ticketExpiresAt: number,
  sessionExpiresAt: number,
}>;

type ActiveSocket = Readonly<{
  socket: WebSocket,
  expiryTimer: NodeJS.Timeout,
}>;

export type MCSCWebSocketAuthorization = Readonly<{
  sessionId: string,
  username: string,
  sessionExpiresAt: number,
}>;

export type MCSCWebSocketTicket = Readonly<{
  protocol: 'mcsc-v1',
  ticket: string,
  expiresAt: number,
}>;

export class MCSCWebSocketAccess {
  private readonly tickets = new Map<string, TicketRecord>();
  private readonly activeSockets = new Map<string, Set<ActiveSocket>>();

  private purgeExpiredTickets(now = Date.now()): void {
    this.tickets.forEach((record, ticket) => {
      if (record.ticketExpiresAt <= now || record.sessionExpiresAt <= now) {
        this.tickets.delete(ticket);
      }
    });
  }

  public issue(
    sessionId: string,
    username: string,
    sessionExpiresAt: number,
  ): MCSCWebSocketTicket {
    const now = Date.now();
    this.purgeExpiredTickets(now);

    if (this.tickets.size >= MaxPendingTickets) {
      throw new Error('Too many pending WebSocket tickets.');
    }

    const ticket = randomBytes(32).toString('base64url');
    const expiresAt = now + TicketLifetimeMs;

    this.tickets.set(ticket, Object.freeze({
      sessionId,
      username,
      ticketExpiresAt: expiresAt,
      sessionExpiresAt,
    }));

    return Object.freeze({
      protocol: 'mcsc-v1',
      ticket,
      expiresAt,
    });
  }

  public consume(ticket: string): MCSCWebSocketAuthorization | null {
    const record = this.tickets.get(ticket);
    this.tickets.delete(ticket);

    if (typeof record === 'undefined') return null;

    const now = Date.now();
    if (record.ticketExpiresAt <= now || record.sessionExpiresAt <= now) {
      return null;
    }

    return Object.freeze({
      sessionId: record.sessionId,
      username: record.username,
      sessionExpiresAt: record.sessionExpiresAt,
    });
  }

  public attach(
    sessionId: string,
    socket: WebSocket,
    sessionExpiresAt: number,
  ): void {
    const timeout = Math.max(1, sessionExpiresAt - Date.now());

    const active: ActiveSocket = {
      socket,
      expiryTimer: setTimeout(() => {
        socket.close(1008, 'Session expired.');
      }, timeout),
    };

    const sockets = this.activeSockets.get(sessionId) ?? new Set<ActiveSocket>();
    sockets.add(active);
    this.activeSockets.set(sessionId, sockets);

    const detach = (): void => {
      clearTimeout(active.expiryTimer);

      const current = this.activeSockets.get(sessionId);
      current?.delete(active);

      if (current?.size === 0) {
        this.activeSockets.delete(sessionId);
      }
    };

    socket.once('close', detach);
    socket.once('error', detach);
  }

  public revokeSession(sessionId: string): void {
    this.tickets.forEach((record, ticket) => {
      if (record.sessionId === sessionId) {
        this.tickets.delete(ticket);
      }
    });

    const sockets = this.activeSockets.get(sessionId);
    this.activeSockets.delete(sessionId);

    sockets?.forEach((active) => {
      clearTimeout(active.expiryTimer);
      active.socket.close(1008, 'Session revoked.');
    });
  }

  public closeAll(): void {
    this.activeSockets.forEach((sockets) => {
      sockets.forEach((active) => {
        clearTimeout(active.expiryTimer);
        active.socket.close(1001, 'Server shutting down.');
      });
    });

    this.activeSockets.clear();
    this.tickets.clear();
  }
}