import { emitLog } from '../general_utils/logger_utils.mjs';
import { createMCSCAuthRouter } from './mcsc_auth.mjs';
import { createWebApp } from './mcsc_app.mjs';
import { createMCSCPageRouter } from './mcsc_viewpage.mjs';
import { createMCSCSession } from './mcsc_session.mjs';
import { loadMCSCWebConfig } from './mcsc_webconf.mjs';
import { closeMCSCWebServ, createMCSCWebServ, listenMCSCWebServ, type MCSCWebServer } from './mcsc_webserv.mjs';
import { MCSCWebSocketAccess } from './mcsc_websocket.mjs';
import { installMCSCWebSocketBridge, type MCSCWebSocketBridge } from './mcsc_wsbridge.mjs';

export type MCSCWebUI = Readonly<{ httpServer: MCSCWebServer, close: () => Promise<void> }>;

export const ignitionMCSCWebUI = async (): Promise<MCSCWebUI> => {
  const { http, initialAdmin, origin, session, tls, trustProxy } = loadMCSCWebConfig();
  const webSocketAccess = new MCSCWebSocketAccess();

  const sessionMiddleware = createMCSCSession(session);
  const authRouter = createMCSCAuthRouter(initialAdmin, {
    origin: origin,
    secureCookie: session.secureCookie,
    webSocketAccess: webSocketAccess,
  });
  const pageRouter = createMCSCPageRouter();
  const app = createWebApp(sessionMiddleware, authRouter, pageRouter, trustProxy);
  const server = createMCSCWebServ(app, tls);
  const webSocketBridge: MCSCWebSocketBridge = installMCSCWebSocketBridge(server, {
    origin: origin, webSockAccess: webSocketAccess,
    servers: globalThis.MCSERV_CONTROLLER_ENV.SERVER_INSTANCES
  });

  let closingPromise: Promise<void> | null = null;
  const closeWebUI = (): Promise<void> => {
    if (closingPromise !== null) return closingPromise;
    webSocketBridge.close();
    closingPromise = closeMCSCWebServ(server);

    return closingPromise;
  };

  await listenMCSCWebServ(server, http);

  const { INFO } = globalThis.MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
  emitLog(
    INFO,
    `WebUI listening on ${tls === null ? 'http' : 'https'}://${http.host}:${http.port}`,
    { optStr: '[WEB-UI]' },
  );

  return Object.freeze({
    httpServer: server,
    close: closeWebUI
  });
};
