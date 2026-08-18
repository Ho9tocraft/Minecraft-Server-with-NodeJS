import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
  type RequestHandler,
  type Router,
} from 'express';
import helmet from 'helmet';
import { emitLog } from '../general_utils/logger_utils.mjs';
import { type MCSCTrustProxy } from './mcsc_webconf.mjs';

export const createWebApp = (sesMidw: RequestHandler, rAuth: Router, trustProxy: MCSCTrustProxy ): Express => {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  // todo: この項目は、ビューキャッシュの無効化に使用(実運用時は…うーん、CSS/JS切り替えに備えて、あったほうがいいかも？)
  app.disable('view cache');
  app.use(helmet());
  app.use(sesMidw);

  app.use(express.json({
    limit: '64kB',
    strict: true,
    type: 'application/json',
  }));

  app.use('/api/auth', rAuth); // REST APIじゃねぇか！www

  app.get('/healthz', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      service: 'mcserv-controller-webui',
    });
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      status: '404 Not Found',
      error: 'not found',
    });
  });

  app.use((error: unknown, _req: Request, res: Response, next: NextFunction): void => {
    if (res.headersSent) {
      next(error);
      return;
    }

    const { ERROR } = globalThis.MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
    const detail = error instanceof Error ? error.message : String(error);

    emitLog(ERROR, `Unhandled HTTP Error: ${detail}`, { optStr: '[WEB-UI]' });
    res.status(500).json({
      status: '500 Internal Server Error',
      error: 'internal_server_error',
    });
  });

  return app;
};
