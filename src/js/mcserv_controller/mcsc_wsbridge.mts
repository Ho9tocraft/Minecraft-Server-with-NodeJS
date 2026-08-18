import { type Server } from 'http';
import { type Duplex } from 'stream';
import { WebSocket, WebSocketServer } from 'ws';
import {
  type MinecraftServerBase,
  type RConStatusSnapshot,
  type ServerConsoleMessage,
} from '../minecraft/servers.mjs';
import { type MCSCWebSocketAccess } from './mcsc_websocket.mjs';

type MCSCWebSocketBridgeOpt = Readonly<{ origin: string, webSockAccess: MCSCWebSocketAccess, servers: readonly MinecraftServerBase[] }>;
type MCSCWebSocketInfo = Readonly<{
  Path: string,
  Protocol: string,
  MaxPayloadBytes: number,
  BufferedBytes: number,
  InitHistoryEntries: number,
  HBInterval: number
}>;
type MCSCWebSocketMessage =
  | Readonly<{ type: 'hello', username: string }>
  | Readonly<{ type: 'console-history', serverId: string, entries: readonly ServerConsoleMessage[] }>
  | Readonly<{ type: 'console-output', serverId: string, entry: ServerConsoleMessage }>
  | Readonly<{ type: 'rcon-status', serverId: string, status: RConStatusSnapshot }>
  | Readonly<{ type: 'command-submitted', serverId: string, commandCount: number }>
  | Readonly<{ type: 'command-rejected', serverId: string, error: 'invalid_message' | 'server_not_found' | 'server_not_running' }>;
type MCSCWebSocketCmdBatch = Readonly<{ serverId: string, cmds: readonly string[] }>;
type HTTPErrorCodeText = // めんどくせーのでここでエラーコード列挙させろォ！
  | '400 Bad Request'
  | '401 Unauthorized'
  | '403 Forbidden'
  | '404 Not Found'
  | '405 Method Not Allowed'
  | '406 Not Acceptable'
  | '408 Request Timeout'
  | '409 Conflict'
  | '410 Gone';

const WebSocketInfomations: MCSCWebSocketInfo = {
  Path: '/ws',
  Protocol: 'mcsc-v1',
  MaxPayloadBytes: 4 * 1024,
  BufferedBytes: 1024 * 1024,
  InitHistoryEntries: 50,
  HBInterval: 30 * 1000,
};

const rejectUpgrade = (socket: Duplex, status: HTTPErrorCodeText): void => {
  const ResHeadEndl = '\r\n';
  socket.write(`HTTP/1.1 ${status}${ResHeadEndl}Connection: close${ResHeadEndl}Content-Length: 0${ResHeadEndl}${ResHeadEndl}`);
  socket.destroy();
};

const extractTicket = (protocolHeader: string | undefined): string | null => {
  if (typeof protocolHeader === 'undefined') return null;

  const requestedProtocol = protocolHeader.split(',').map((protocol) => protocol.trim());

  const protocol = requestedProtocol[0];
  const ticket = requestedProtocol[1];

  if (requestedProtocol.length !== 2 || protocol !== WebSocketInfomations.Protocol
    || typeof ticket === 'undefined' || !/^[A-Za-z0-9_-]{43}$/.test(ticket)) return null;
  
  return ticket;
};

const parseCmdBatch = (data: WebSocket.RawData, isBin: boolean): MCSCWebSocketCmdBatch | null => {
  if (isBin) return null;

  let rawMsg: string;

  if (Array.isArray(data)) rawMsg = Buffer.concat(data).toString('utf-8');
  else if (Buffer.isBuffer(data)) rawMsg = data.toString('utf-8');
  else rawMsg = Buffer.from(data).toString('utf-8');

  let parseMsg: unknown;

  try {
    parseMsg = JSON.parse(rawMsg);
  } catch {
    return null;
  }

  if (typeof parseMsg !== 'object' || parseMsg === null || Array.isArray(parseMsg)) return null;

  const msg = parseMsg as Record<string, unknown>;
  const serverId = msg.serverId;
  const cmds = msg.commands;

  if (msg.type !== 'command-batch' || typeof serverId !== 'string'
    || serverId.length === 0 || serverId.length > 128 || !Array.isArray(cmds)
    || cmds.length === 0 || cmds.length > 32 || !cmds.every((cmd) => typeof cmd === 'string')) return null;
    
  return Object.freeze({ serverId: serverId, cmds: Object.freeze([...cmds]) });
};

const handleCmdBatch = (socket: WebSocket, data: WebSocket.RawData, isBin: boolean, servers: readonly MinecraftServerBase[]): void => {
  const cmdBatch = parseCmdBatch(data, isBin);

  if (cmdBatch === null) {
    sendMessage(socket, {
      type: 'command-rejected',
      serverId: '',
      error: 'invalid_message'
    });
    return;
  }

  const tgtServ = servers.find((serv) => { return serv.srvId === cmdBatch.serverId });
  if (typeof tgtServ === 'undefined') {
    sendMessage(socket, {
      type: 'command-rejected',
      serverId: cmdBatch.serverId,
      error: 'server_not_found'
    });
    return;
  }

  if (tgtServ.runningStat !== 'RUNNING') {
    sendMessage(socket, {
      type: 'command-rejected',
      serverId: cmdBatch.serverId,
      error: 'server_not_running'
    });
    return;
  }

  tgtServ.executeConsoleCommands(cmdBatch.cmds);

  sendMessage(socket, {
    type: 'command-submitted',
    serverId: cmdBatch.serverId,
    commandCount: cmdBatch.cmds.length
  });
};

const sendMessage = (socket: WebSocket, message: MCSCWebSocketMessage): void => {
  if (socket.readyState !== WebSocket.OPEN) return;

  if (socket.bufferedAmount > WebSocketInfomations.BufferedBytes) {
    socket.close(1013, 'Client too slow');
    return;
  }

  try {
    socket.send(JSON.stringify(message));
  } catch {
    socket.terminate();
  }
}

const subscribeServerEvents = (socket: WebSocket, servers: readonly MinecraftServerBase[]): (() => void) => {
  const unsubscribeFunc: Array<() => void> = [];

  servers.forEach((server) => {
    const onConsoleOut = (entry: ServerConsoleMessage): void => {
      sendMessage(socket, { type: 'console-output', serverId: server.srvId, entry: entry });
    };
    const onRConStatus = (status: RConStatusSnapshot): void => {
      sendMessage(socket, { type: 'rcon-status', serverId: server.srvId, status: status });
    };

    server.on('console-output', onConsoleOut);
    server.on('rcon-status', onRConStatus);

    unsubscribeFunc.push(() => {
      server.off('console-output', onConsoleOut);
      server.off('rcon-status', onRConStatus);
    });

    const historyEntries = server.getConsoleHistory().slice(-WebSocketInfomations.InitHistoryEntries);
    sendMessage(socket, { type: 'console-history', serverId: server.srvId, entries: historyEntries });
    sendMessage(socket, { type: 'rcon-status', serverId: server.srvId, status: server.getRConStatus() });
  });

  return (): void => { unsubscribeFunc.forEach((unsub) => { unsub(); }) };
}

export const installMCSCWebSocketBridge = (httpServer: Server, options: MCSCWebSocketBridgeOpt): WebSocketServer => {
  const webSocketServer = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    maxPayload: WebSocketInfomations.MaxPayloadBytes,
    perMessageDeflate: false,
    handleProtocols: (reqProtocol): string | false => {
      return reqProtocol.has(WebSocketInfomations.Protocol) ? WebSocketInfomations.Protocol : false;
    }
  });

  httpServer.on('upgrade', (req, sock, head): void => {
    let reqURL: URL;

    try {
      reqURL = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      rejectUpgrade(sock, '400 Bad Request');
      return;
    }

    if (reqURL.pathname !== WebSocketInfomations.Path || reqURL.search.length > 0) {
      rejectUpgrade(sock, '404 Not Found');
      return;
    }

    if (req.headers.origin !== options.origin) {
      rejectUpgrade(sock, '403 Forbidden');
      return;
    }

    const ticket = extractTicket(req.headers['sec-websocket-protocol']);
    if (ticket === null) {
      rejectUpgrade(sock, '401 Unauthorized');
      return;
    }
    const auth = options.webSockAccess.consume(ticket);
    if (auth === null) {
      rejectUpgrade(sock, '401 Unauthorized');
      return;
    }

    webSocketServer.handleUpgrade(req, sock, head, (webSocket): void => {
      webSocket.on('error', (): void => undefined);

      options.webSockAccess.attach(auth.sessionId, webSocket, auth.sessionExpiresAt);

      sendMessage(webSocket, {
        type: 'hello',
        username: auth.username,
      });

      const unsub = subscribeServerEvents(webSocket, options.servers);

      let awaitingPong = false;
      const heartbeatTimer = setInterval(() => {
        if (awaitingPong) {
          webSocket.terminate();
          return;
        }

        awaitingPong = true;
        webSocket.ping();
      }, WebSocketInfomations.HBInterval);

      heartbeatTimer.unref();

      webSocket.on('pong', (): void => {
        awaitingPong = false;
      }).on('message', (data, isBin): void => {
        handleCmdBatch(webSocket, data, isBin, options.servers);
      }).once('close', (): void => {
        clearInterval(heartbeatTimer);
        unsub();
      });
    });
  });

  return webSocketServer;
};
