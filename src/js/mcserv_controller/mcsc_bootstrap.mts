import type { Server } from 'http';
import { emitLog } from '../general_utils/logger_utils.mjs';
import { createMCSCAuthRouter } from './mcsc_auth.mjs';
import { createWebApp } from './mcsc_app.mjs';
import { createMCSCSession } from './mcsc_session.mjs';
import { loadMCSCWebConfig } from './mcsc_webconf.mjs';
import { createMCSCHTTPServ, listenMCSCHTTPServ } from './mcsc_webserv.mjs';
import { MCSCWebSocketAccess } from './mcsc_websocket.mjs';
import { installMCSCWebSocketBridge } from './mcsc_wsbridge.mjs';

export const ignitionMCSCWebUI = async (): Promise<Server> => {
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
  installMCSCWebSocketBridge(server, {
    origin: origin, webSockAccess: webSocketAccess,
    servers: globalThis.MCSERV_CONTROLLER_ENV.SERVER_INSTANCES,
  });

  await listenMCSCHTTPServ(server, http);

  const { INFO } = globalThis.MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
  emitLog(
    INFO,
    `WebUI listening on http://${http.host}:${http.port}`,
    { optStr: '[WEB-UI]' },
  );

  return server;
};
