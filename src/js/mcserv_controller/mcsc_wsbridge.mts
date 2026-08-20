import { IncomingMessage } from 'http';
import { type Duplex } from 'stream';
import { WebSocket, WebSocketServer } from 'ws';
import {
  type MinecraftServerBase,
  type RConStatusSnapshot,
  type ScheduleOverrideInput,
  type ServerConsoleMessage,
  type ServerMetadata,
  type ServerPlayerSnapshot,
  type ServerStatusSnapshot,
  type ServerScheduleUpdate,
} from '../minecraft/servers.mjs';
import { SSMan, type ServerScheduleSnapshot } from '../minecraft/scheduler.mjs';
import {
  readServerConfig,
  writeServerConfig,
  type ServerConfigChange,
  ServerConfigReadError,
  type ServerConfigReadErrorCode,
  type ServerConfigSnapshot,
} from './mcsc_server_config.mjs';
import { type MCSCWebSocketAccess } from './mcsc_websocket.mjs';
import { type MCSCWebServer } from './mcsc_webserv.mjs';

type MCSCWSServerErrorMsg = 'server_not_found' | 'server_not_running';
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
  | Readonly<{ type: 'server-list', servers: readonly ServerMetadata[] }>
  | Readonly<{ type: 'server-status', serverId: string, status: ServerStatusSnapshot }>
  | Readonly<{ type: 'player-status', serverId: string, status: ServerPlayerSnapshot }>
  | Readonly<{ type: 'server-control-submitted', serverId: string, action: 'start' | 'stop' | 'restart' }>
  | Readonly<{ type: 'server-control-rejected', serverId: string, error: 'server_already_active' | 'maintenance_locked' | MCSCWSServerErrorMsg }>
  | Readonly<{ type: 'maintenance-submitted', serverId: string, enabled: boolean }>
  | Readonly<{ type: 'maintenance-rejected', serverId: string, error: MCSCWSServerErrorMsg }>
  | Readonly<{ type: 'console-history', serverId: string, entries: readonly ServerConsoleMessage[] }>
  | Readonly<{ type: 'console-output', serverId: string, entry: ServerConsoleMessage }>
  | Readonly<{ type: 'rcon-status', serverId: string, status: RConStatusSnapshot }>
  | Readonly<{ type: 'schedule-status', serverId: string, status: ServerScheduleSnapshot }>
  | Readonly<{ type: 'schedule-submitted', serverId: string, status: ServerScheduleSnapshot }>
  | Readonly<{ type: 'schedule-rejected', serverId: string, error: 'invalid_schedule' | MCSCWSServerErrorMsg }>
  | Readonly<{ type: 'config-content', serverId: string, config: ServerConfigSnapshot }>
  | Readonly<{ type: 'config-rejected', serverId: string, error: ServerConfigReadErrorCode | MCSCWSServerErrorMsg }>
  | Readonly<{ type: 'command-submitted', serverId: string, commandCount: number }>
  | Readonly<{ type: 'command-rejected', serverId: string, error: 'invalid_message' | MCSCWSServerErrorMsg }>
  | Readonly<{ type: 'request-rejected', error: 'invalid_message' }>
  | Readonly<{ type: 'rcon-disconnect-submitted', serverId: string }>
  | Readonly<{ type: 'rcon-disconnect-rejected', serverId: string, error: 'rcon_unavailable' | MCSCWSServerErrorMsg }>;
type MCSCWebSocketCmdBatch = Readonly<{ type: 'command-batch', serverId: string, cmds: readonly string[] }>;
type MCSCWebSocketRConDisconnect = Readonly<{ type: 'rcon-disconnect', serverId: string }>;
type MCSCWebSocketServerControl = Readonly<{ type: 'server-control', serverId: string, act: 'start' | 'stop' | 'restart' }>;
type MCSCWebSocketMaintenanceSet = Readonly<{ type: 'maintenance-set', serverId: string, enabled: boolean }>;
type MCSCWebSocketScheduleSet = Readonly<{ type: 'schedule-set', serverId: string, schedule: ServerScheduleUpdate }>;
type MCSCWebSocketConfigGet = Readonly<{ type: 'config-get', serverId: string }>;
type MCSCWebSocketConfigSet = Readonly<{ type: 'config-set', serverId: string, revision: string, changes: readonly ServerConfigChange[] }>;
type MCSCWebSocketIncomingTell =
  | MCSCWebSocketCmdBatch
  | MCSCWebSocketRConDisconnect
  | MCSCWebSocketMaintenanceSet
  | MCSCWebSocketScheduleSet
  | MCSCWebSocketConfigGet
  | MCSCWebSocketConfigSet
  | MCSCWebSocketServerControl;
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
export type MCSCWebSocketBridge = Readonly<{ close: () => void }>;

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

const isScheduleOverrideInput = (
  value: unknown,
): value is ScheduleOverrideInput => {
  if (typeof value !== 'object' || value === null) return false;

  const input = value as Record<string, unknown>;

  return (
    typeof input.useOverride === 'boolean'
    && typeof input.motd === 'string'
    && input.motd.length <= 128
    && typeof input.exec === 'string'
    && input.exec.length <= 128
  );
};

const isServerScheduleUpdate = (
  value: unknown,
): value is ServerScheduleUpdate => {
  if (typeof value !== 'object' || value === null) return false;

  const input = value as Record<string, unknown>;

  return (
    typeof input.start === 'string'
    && input.start.length <= 128
    && isScheduleOverrideInput(input.reboot)
    && isScheduleOverrideInput(input.shutdown)
  );
};

const parseIncomingTell = (data: WebSocket.RawData, isBin: boolean): MCSCWebSocketIncomingTell | null => {
  if (isBin) return null;
  let rawMsg: string;

  if (Array.isArray(data)) rawMsg = Buffer.concat(data).toString('utf-8');
  else if (Buffer.isBuffer(data)) rawMsg = data.toString('utf-8');
  else rawMsg = Buffer.from(data).toString('utf-8');

  let parsedMsg: unknown;

  try { parsedMsg = JSON.parse(rawMsg); }
  catch { return null; }

  if (typeof parsedMsg !== 'object' || parsedMsg === null || Array.isArray(parsedMsg)) return null;

  const msg = parsedMsg as Record<string, unknown>;
  const { action: act, changes, cmds, enabled, revision, schedule: cron, serverId, type } = msg;

  if (typeof serverId !== 'string' || serverId.length === 0 || serverId.length > 128) return null;

  if (type === 'rcon-disconnect') return Object.freeze({
    type: 'rcon-disconnect',
    serverId: serverId
  });
  if (type === 'maintenance-set' && typeof enabled === 'boolean') return Object.freeze({
    type: 'maintenance-set',
    serverId: serverId,
    enabled: enabled
  });
  if (type === 'schedule-set' && isServerScheduleUpdate(cron)) {
    return Object.freeze({
      type: 'schedule-set',
      serverId: serverId,
      schedule: Object.freeze({
        start: cron.start,
        reboot: Object.freeze({
          useOverride: cron.reboot.useOverride,
          motd: cron.reboot.motd,
          exec: cron.reboot.exec,
        }),
        shutdown: Object.freeze({
          useOverride: cron.shutdown.useOverride,
          motd: cron.shutdown.motd,
          exec: cron.shutdown.exec,
        }),
      }),
    });
  }
  if (type === 'config-get') return Object.freeze({
    type: 'config-get',
    serverId: serverId,
  });
  if (type === 'config-set' && typeof revision === 'string' && /^[a-f0-9]{64}$/.test(revision)
    && Array.isArray(changes) && changes.length > 0 && changes.length <= 64
    && changes.every((change) => typeof change === 'object' && change !== null
      && typeof change.key === 'string' && change.key.length > 0 && change.key.length <= 128
      && typeof change.value === 'string' && change.value.length <= 1024)) {
    return Object.freeze({
      type: 'config-set', serverId, revision,
      changes: Object.freeze(changes.map((change) => Object.freeze({
        key: (change as ServerConfigChange).key,
        value: (change as ServerConfigChange).value,
      }))),
    });
  }
  if (type === 'server-control' && (act === 'start' || act === 'stop' || act === 'restart')) return Object.freeze({
    type: 'server-control',
    serverId: serverId,
    act: act
  });

  if (type !== 'command-batch' || !Array.isArray(cmds) || cmds.length === 0
    || cmds.length > 32 || !cmds.every((cmd) => typeof cmd === 'string')) return null;
  return Object.freeze({
    type: 'command-batch',
    serverId: serverId,
    cmds: Object.freeze([...cmds])
  });
}

const handleConfigGet = async (
  socket: WebSocket,
  configReq: MCSCWebSocketConfigGet,
  servers: readonly MinecraftServerBase[],
): Promise<void> => {
  const targetServer = servers.find((server) => server.srvId === configReq.serverId);

  if (typeof targetServer === 'undefined') {
    sendMessage(socket, {
      type: 'config-rejected',
      serverId: configReq.serverId,
      error: 'server_not_found',
    });
    return;
  }

  try {
    const config = await readServerConfig(targetServer);

    sendMessage(socket, {
      type: 'config-content',
      serverId: targetServer.srvId,
      config,
    });
  } catch (error) {
    const errorCode = error instanceof ServerConfigReadError
      ? error.code
      : 'config_read_failed';

    sendMessage(socket, {
      type: 'config-rejected',
      serverId: targetServer.srvId,
      error: errorCode,
    });
  }
};

const handleConfigSet = async (socket: WebSocket, request: MCSCWebSocketConfigSet, servers: readonly MinecraftServerBase[]): Promise<void> => {
  const targetServer = servers.find((server) => server.srvId === request.serverId);
  if (typeof targetServer === 'undefined') {
    sendMessage(socket, { type: 'config-rejected', serverId: request.serverId, error: 'server_not_found' });
    return;
  }
  try {
    const config = await writeServerConfig(targetServer, request.revision, request.changes);
    sendMessage(socket, { type: 'config-content', serverId: targetServer.srvId, config });
  } catch (error) {
    sendMessage(socket, {
      type: 'config-rejected', serverId: targetServer.srvId,
      error: error instanceof ServerConfigReadError ? error.code : 'config_read_failed',
    });
  }
};

const handleCmdBatch = (socket: WebSocket, cmdBatch: MCSCWebSocketCmdBatch, servers: readonly MinecraftServerBase[]): void => {
  const tgtServ = servers.find((server) => { return server.srvId === cmdBatch.serverId; });

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

const handleRConDisconnect = (socket: WebSocket, disconnReq: MCSCWebSocketRConDisconnect, servers: readonly MinecraftServerBase[]): void => {
  const tgtServ = servers.find((server) => { return server.srvId === disconnReq.serverId; });

  if (typeof tgtServ === 'undefined') {
    sendMessage(socket, {
      type: 'rcon-disconnect-rejected',
      serverId: disconnReq.serverId,
      error: 'server_not_found'
    });
    return;
  }
  if (!tgtServ.rconCompatible || tgtServ.rconClient.FBMode) {
    sendMessage(socket, {
      type: 'rcon-disconnect-rejected',
      serverId: disconnReq.serverId,
      error: 'rcon_unavailable'
    });
    return;
  }

  tgtServ.disconnectRcon();

  sendMessage(socket, {
    type: 'rcon-disconnect-submitted',
    serverId: disconnReq.serverId
  });
};

const handleMaintenanceSet = (socket: WebSocket, maintenanceReq: MCSCWebSocketMaintenanceSet, servers: readonly MinecraftServerBase[]): void => {
  const targetServer = servers.find((server) => { return server.srvId === maintenanceReq.serverId; });

  if (typeof targetServer === 'undefined') {
    sendMessage(socket, {
      type: 'maintenance-rejected',
      serverId: maintenanceReq.serverId,
      error: 'server_not_found',
    });
    return;
  }

  targetServer.setMaintenanceMode(maintenanceReq.enabled);

  sendMessage(socket, {
    type: 'maintenance-submitted',
    serverId: maintenanceReq.serverId,
    enabled: maintenanceReq.enabled
  });
};

const handleScheduleSet = (
  socket: WebSocket,
  scheduleReq: MCSCWebSocketScheduleSet,
  servers: readonly MinecraftServerBase[],
): void => {
  const targetServer = servers.find((server) => {
    return server.srvId === scheduleReq.serverId;
  });

  if (typeof targetServer === 'undefined') {
    sendMessage(socket, {
      type: 'schedule-rejected',
      serverId: scheduleReq.serverId,
      error: 'server_not_found',
    });
    return;
  }

  try {
    targetServer.setScheduleConfig(scheduleReq.schedule);
    SSMan.refresh(targetServer);
  } catch {
    sendMessage(socket, {
      type: 'schedule-rejected',
      serverId: scheduleReq.serverId,
      error: 'invalid_schedule',
    });
    return;
  }

  sendMessage(socket, {
    type: 'schedule-submitted',
    serverId: scheduleReq.serverId,
    status: SSMan.getSnapshot(targetServer),
  });
};

const handleServControl = (socket: WebSocket, controlReq: MCSCWebSocketServerControl, servers: readonly MinecraftServerBase[]): void => {
  const { serverId, act } = controlReq;
  const tgtServ = servers.find((server) => { return server.srvId === serverId; });

  if (typeof tgtServ === 'undefined') {
    sendMessage(socket, {
      type: 'server-control-rejected',
      serverId: controlReq.serverId,
      error: 'server_not_found'
    });
    return;
  }

  if (act === 'start') {
    const { maintenance, processAlive: procIsAl, status } = tgtServ.getServStatus();

    if (procIsAl) {
      sendMessage(socket, {
        type: 'server-control-rejected',
        serverId: serverId,
        error: 'server_already_active'
      });
      return;
    }

    if (status === 'DEPLETED' && maintenance) {
      sendMessage(socket, {
        type: 'server-control-rejected',
        serverId: serverId,
        error: 'maintenance_locked'
      });
      return;
    }

    tgtServ.startServer();
  } else {
    if (tgtServ.runningStat !== 'RUNNING') {
      sendMessage(socket, {
        type: 'server-control-rejected',
        serverId: serverId,
        error: 'server_not_running'
      });
      return;
    }

    if (act === 'stop') tgtServ.stopServer();
    else tgtServ.restartServer();
  }

  sendMessage(socket, {
    type: 'server-control-submitted',
    serverId: serverId,
    action: act
  });
};

const handleIncomingTell = (socket: WebSocket, data: WebSocket.RawData, isBin: boolean, servers: readonly MinecraftServerBase[]): void => {
  const incomingTell = parseIncomingTell(data, isBin);

  if (incomingTell === null) {
    sendMessage(socket, {
      type: 'request-rejected',
      error: 'invalid_message'
    });
    return;
  }

  switch (incomingTell.type) {
    case 'command-batch':
      handleCmdBatch(socket, incomingTell, servers);
      break;
    case 'rcon-disconnect':
      handleRConDisconnect(socket, incomingTell, servers);
      break;
    case 'maintenance-set':
      handleMaintenanceSet(socket, incomingTell, servers);
      break;
    case 'schedule-set':
      handleScheduleSet(socket, incomingTell, servers);
      break;
    case 'config-get':
      void handleConfigGet(socket, incomingTell, servers);
      break;
    case 'config-set':
      void handleConfigSet(socket, incomingTell, servers);
      break;
    case 'server-control':
      handleServControl(socket, incomingTell, servers);
      break;
    default:
      break;
  }
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
    const onServerStatus = (status: ServerStatusSnapshot): void => {
      sendMessage(socket, { type: 'server-status', serverId: server.srvId, status: status });
    };
    const onPlayerStatus = (status: ServerPlayerSnapshot): void => {
      sendMessage(socket, { type: 'player-status', serverId: server.srvId, status: status });
    };
    const onScheduleStatus = (status: ServerScheduleSnapshot): void => {
      sendMessage(socket, {
        type: 'schedule-status',
        serverId: server.srvId,
        status: status,
      });
    };

    server.on('console-output', onConsoleOut);
    server.on('rcon-status', onRConStatus);
    server.on('server-status', onServerStatus);
    server.on('player-status', onPlayerStatus);
    server.on('schedule-status', onScheduleStatus);

    unsubscribeFunc.push(() => {
      server.off('console-output', onConsoleOut);
      server.off('rcon-status', onRConStatus);
      server.off('server-status', onServerStatus);
      server.off('player-status', onPlayerStatus);
      server.off('schedule-status', onScheduleStatus);
    });

    // 初期値送信
    const historyEntries = server.getConsoleHistory().slice(-WebSocketInfomations.InitHistoryEntries);
    sendMessage(socket, { type: 'console-history', serverId: server.srvId, entries: historyEntries });
    sendMessage(socket, { type: 'rcon-status', serverId: server.srvId, status: server.getRConStatus() });
    sendMessage(socket, { type: 'server-status', serverId: server.srvId, status: server.getServStatus() });
    sendMessage(socket, { type: 'player-status', serverId: server.srvId, status: server.getOnlinePlayers() });
    sendMessage(socket, { type: 'schedule-status', serverId: server.srvId, status: SSMan.getSnapshot(server) });
  });

  return (): void => { unsubscribeFunc.forEach((unsub) => { unsub(); }) };
}

export const installMCSCWebSocketBridge = (httpServer: MCSCWebServer, options: MCSCWebSocketBridgeOpt): MCSCWebSocketBridge => {
  const webSocketServer = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    maxPayload: WebSocketInfomations.MaxPayloadBytes,
    perMessageDeflate: false,
    handleProtocols: (reqProtocol): string | false => {
      return reqProtocol.has(WebSocketInfomations.Protocol) ? WebSocketInfomations.Protocol : false;
    }
  });

  let isClosing = false;
  const handleUpgrade = (req: IncomingMessage, sock: Duplex, head: Buffer<ArrayBuffer>): void => {
    if (isClosing) {
      rejectUpgrade(sock, '410 Gone');
      return;
    }

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

      const servMDat = Object.freeze(options.servers.map((server) => {
        return server.getServMDat();
      }));

      sendMessage(webSocket, {
        type: 'server-list',
        servers: servMDat,
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
        handleIncomingTell(webSocket, data, isBin, options.servers);
      }).once('close', (): void => {
        clearInterval(heartbeatTimer);
        unsub();
      });
    });
  };

  httpServer.on('upgrade', handleUpgrade);

  return Object.freeze({
    close: (): void => {
      if (isClosing) return;

      isClosing = true;
      options.webSockAccess.closeAll();
      webSocketServer.close();
    }
  });
};
