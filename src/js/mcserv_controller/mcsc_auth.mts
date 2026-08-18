import { timingSafeEqual } from 'crypto';
import type { Request, RequestHandler } from 'express';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import argon2 from 'argon2';

import { MCSCSessionMaxAgeMs } from './mcsc_session.mjs';
import { type MCSCWebSocketAccess } from './mcsc_websocket.mjs';

export type MCSCAdminCredential = Readonly<{
  username: string,
  passHash: string,
}>;

export type MCSCAuthOptions = Readonly<{
  origin: string,
  secureCookie: boolean,
  webSocketAccess: MCSCWebSocketAccess,
}>;

export type MCSCAdminSession = Readonly<{
  username: string,
  authenticatedAt: number,
}>;

declare module 'express-session' {
  interface SessionData {
    admin?: MCSCAdminSession,
  }
}

const SessionCookieName = 'mcserv_cont.sid';

const isString = (value: unknown): value is string => {
  return typeof value === 'string';
};

const getLoginInput = (
  body: unknown,
): Readonly<{ username: string, password: string }> => {
  if (typeof body !== 'object' || body === null) {
    return { username: '', password: '' };
  }

  const record = body as Record<string, unknown>;
  const username = isString(record.username) ? record.username : '';
  const password = isString(record.password) ? record.password : '';

  return {
    username: username.length <= 64 ? username : '',
    password: password.length <= 1024 ? password : '',
  };
};

const usernameMatches = (input: string, expected: string): boolean => {
  const inputBuffer = Buffer.from(input, 'utf-8');
  const expectedBuffer = Buffer.from(expected, 'utf-8');

  return inputBuffer.length === expectedBuffer.length
    && timingSafeEqual(inputBuffer, expectedBuffer);
};

const regenerateSession = (req: Request): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
};

const saveSession = (req: Request): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    req.session.save((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
};

const destroySession = (req: Request): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    req.session.destroy((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
};

export const requireMCSCAdmin: RequestHandler = (req, res, next): void => {
  if (typeof req.session.admin === 'undefined') {
    res.status(401).json({ error: 'authentication_required' });
    return;
  }

  next();
};

export const createMCSCAuthRouter = (admin: MCSCAdminCredential, options: MCSCAuthOptions): Router => {
  const router = Router();
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  })

  const requireSameOrigin: RequestHandler = (req, res, next): void => {
    if (req.get('origin') !== options.origin) {
      res.status(403).json({ error: 'invalid_origin' });
      return;
    }

    next();
  };

  const loginRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'too_many_login_attempts' },
  });

  router.get('/session', (req, res): void => {
    const adminSession = req.session.admin;

    if (typeof adminSession === 'undefined') {
      res.status(200).json({ authenticated: false });
      return;
    }

    res.status(200).json({
      authenticated: true,
      username: adminSession.username,
      authenticatedAt: adminSession.authenticatedAt,
    });
  });

  router.post('/login', requireSameOrigin, loginRateLimit,
    async (req, res, next): Promise<void> => {
      try {
        const input = getLoginInput(req.body);

        // ユーザー名が不一致でもArgon2検証を行い、判定時間差を小さくする。
        const passwordMatches = await argon2.verify(admin.passHash, input.password);
        const authenticated = usernameMatches(input.username, admin.username)
          && passwordMatches;

        if (!authenticated) {
          res.status(401).json({
            status: '401 Unauthorized',
            error: 'invalid_credentials'
          });
          return;
        }

        await regenerateSession(req);

        req.session.admin = Object.freeze({
          username: admin.username,
          authenticatedAt: Date.now(),
        });

        await saveSession(req);
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  router.post('/ws-ticket', requireSameOrigin, requireMCSCAdmin,
    (req, res, next): void => {
      try {
        const adminSession = req.session.admin;
        if (typeof adminSession === 'undefined') {
          res.status(401).json({
            status: '401 Unauthorized',
            error: 'authentication_required'
          });
          return;
        }

        const ticket = options.webSocketAccess.issue(
          req.sessionID, adminSession.username,
          Date.now() + MCSCSessionMaxAgeMs,
        );

        res.status(200).json(ticket);
      } catch (err) {
        next(err);
      }
    });

  router.post('/logout', requireSameOrigin, requireMCSCAdmin,
    async (req, res, next): Promise<void> => {
      try {
        const sessionId = req.sessionID;
        options.webSocketAccess.revokeSession(sessionId);
        await destroySession(req);

        res.clearCookie(SessionCookieName, {
          httpOnly: true,
          sameSite: 'strict',
          secure: options.secureCookie,
        });

        res.status(204).end();
      } catch (error) {
        next(error);
      }
    });

  return router;
};
