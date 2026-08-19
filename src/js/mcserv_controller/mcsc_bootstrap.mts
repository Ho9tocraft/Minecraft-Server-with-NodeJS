import type { Server } from 'http';
import { emitLog } from '../general_utils/logger_utils.mjs';
import { createMCSCAuthRouter } from './mcsc_auth.mjs';
import { createWebApp } from './mcsc_app.mjs';
import { createMCSCSession } from './mcsc_session.mjs';
import { loadMCSCWebConfig } from './mcsc_webconf.mjs';
import { closeMCSCHTTPServ, createMCSCHTTPServ, listenMCSCHTTPServ } from './mcsc_webserv.mjs';
import { MCSCWebSocketAccess } from './mcsc_websocket.mjs';
import { installMCSCWebSocketBridge, type MCSCWebSocketBridge } from './mcsc_wsbridge.mjs';

export type MCSCWebUI = Readonly<{ httpServer: Server, close: () => Promise<void> }>;

export const ignitionMCSCWebUI = async (): Promise<MCSCWebUI> => {
  const { http, initialAdmin, origin, session, trustProxy } = loadMCSCWebConfig();
  const webSocketAccess = new MCSCWebSocketAccess();

  const sessionMiddleware = createMCSCSession(session);
  const authRouter = createMCSCAuthRouter(initialAdmin, {
    origin: origin,
    secureCookie: session.secureCookie,
    webSocketAccess: webSocketAccess,
  });
  const app = createWebApp(sessionMiddleware, authRouter, trustProxy);
  const server = createMCSCHTTPServ(app);
  const webSocketBridge: MCSCWebSocketBridge = installMCSCWebSocketBridge(server, {
    origin: origin, webSockAccess: webSocketAccess,
    servers: globalThis.MCSERV_CONTROLLER_ENV.SERVER_INSTANCES
  });

  let closingPromise: Promise<void> | null = null;
  const closeWebUI = (): Promise<void> => {
    if (closingPromise !== null) return closingPromise;
    webSocketBridge.close();
    closingPromise = closeMCSCHTTPServ(server);

    return closingPromise;
  };

  await listenMCSCHTTPServ(server, http);

  const { INFO } = globalThis.MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
  emitLog(
    INFO,
    `WebUI listening on http://${http.host}:${http.port}`,
    { optStr: '[WEB-UI]' },
  );

  return Object.freeze({
    httpServer: server,
    close: closeWebUI
  });
};
