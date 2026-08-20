import type { RequestHandler } from 'express';
import session from 'express-session';
import sessionFileStore from 'session-file-store';

export const MCSCSessionMaxAgeMs = 7 * 24 * 60 * 60 * 1000; // 1週間
const SessionTtlSeconds = MCSCSessionMaxAgeMs / 1000;

export type MCSCSessionOptions = Readonly<{
  secret: string,
  directory: string,
  secureCookie: boolean,
}>;

export const createMCSCSession = (
  options: MCSCSessionOptions,
): RequestHandler => {
  const { secret, directory, secureCookie } = options;

  if (Buffer.byteLength(secret, 'utf-8') < 32) {
    throw new RangeError('Session secret must contain at least 32 UTF-8 bytes.');
  }

  if (directory.trim().length === 0) {
    throw new RangeError('Session directory must not be empty.');
  }

  const FileStore = sessionFileStore(session);

  return session({
    name: 'mcserv_cont.sid',
    secret,
    store: new FileStore({
      path: directory,
      secret,
      ttl: SessionTtlSeconds,
      reapInterval: 60 * 60,
      retries: 0,
    }),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    unset: 'destroy',
    cookie: {
      httpOnly: true,
      sameSite: 'strict',
      secure: secureCookie,
      maxAge: MCSCSessionMaxAgeMs,
    },
  });
};
