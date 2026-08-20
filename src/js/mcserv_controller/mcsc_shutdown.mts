import { emitLog } from '../general_utils/logger_utils.mjs';
import { SSMan } from '../minecraft/scheduler.mjs';
import { type MinecraftServerBase, type ServerStatusSnapshot } from '../minecraft/servers.mjs';
import { type MCSCWebUI } from './mcsc_bootstrap.mjs';

const GracefulShutdownTimeoutMs = 3 * 60 * 1000 + 10 * 1000;

/** 正常停止要求後、Minecraftプロセスが終了するか停止期限に達するまで待機する。 */
const waitForServerStop = (server: MinecraftServerBase): Promise<boolean> => {
  if (!server.getServStatus().processAlive) return Promise.resolve(true);

  return new Promise<boolean>((resolve) => {
    const complete = (stopped: boolean): void => {
      clearTimeout(timeout);
      server.off('server-status', onStatus);
      resolve(stopped);
    };
    const onStatus = (status: ServerStatusSnapshot): void => {
      if (!status.processAlive) complete(true);
    };
    const timeout = setTimeout(() => { complete(false); }, GracefulShutdownTimeoutMs);

    server.on('server-status', onStatus);
    server.stopForHostShutdown();
  });
};

/**
 * 運用OSの終了シグナルを受け、WebUIと管理対象サーバーを順に正常終了させる。
 * 同時に複数シグナルを受けても、最初の終了処理だけを実行する。
 */
export const installMCSCGracefulShutdown = (webUI: MCSCWebUI): void => {
  let closingPromise: Promise<void> | null = null;

  const shutdown = (signal: string): Promise<void> => {
    if (closingPromise !== null) return closingPromise;

    closingPromise = (async (): Promise<void> => {
      const { ERROR, INFO, WARN } = globalThis.MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
      const servers = globalThis.MCSERV_CONTROLLER_ENV.SERVER_INSTANCES;

      emitLog(INFO, `Received ${signal}. Starting graceful shutdown.`, { optStr: '[SHUTDOWN]' });
      SSMan.clear();
      await webUI.close();

      const results = await Promise.all(servers.map((server) => { return waitForServerStop(server); }));
      const incompleteServers = servers.filter((_server, index) => results[index] !== true);

      if (incompleteServers.length > 0) {
        emitLog(
          ERROR,
          `Graceful shutdown timeout: ${incompleteServers.map((server) => server.srvId).join(', ')}`,
          { optStr: '[SHUTDOWN]' },
        );
        process.exitCode = 1;
        return;
      }

      emitLog(INFO, 'Graceful shutdown completed.', { optStr: '[SHUTDOWN]' });
    })().catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      const { ERROR } = globalThis.MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;

      emitLog(ERROR, `Graceful shutdown failed: ${detail}`, { optStr: '[SHUTDOWN]' });
      process.exitCode = 1;
    });

    return closingPromise;
  };

  const handleSignal = (signal: string): void => { void shutdown(signal); };

  process.once('SIGINT', () => { handleSignal('SIGINT'); });
  process.once('SIGTERM', () => { handleSignal('SIGTERM'); });
  if (process.platform === 'win32') process.once('SIGBREAK', () => { handleSignal('SIGBREAK'); });
};
