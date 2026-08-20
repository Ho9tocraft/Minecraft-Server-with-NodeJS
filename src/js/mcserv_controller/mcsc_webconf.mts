import { resolve } from 'path';
import type { MCSCHTTPServOpt, MCSCTLSOptions } from './mcsc_webserv.mjs';
import type { MCSCSessionOptions } from './mcsc_session.mjs';

export type MCSCTrustProxy = false | string;
export type MCSCWebConfig = Readonly<{
  origin: string,
  http: MCSCHTTPServOpt,
  tls: MCSCTLSOptions | null,
  session: MCSCSessionOptions,
  initialAdmin: Readonly<{
    username: string,
    passHash: string,
  }>
  trustProxy: MCSCTrustProxy,
}>;

const requireEnv = (name: string, env: NodeJS.ProcessEnv): string => {
  const value = env[name]?.trim();

  if (typeof value === 'undefined' || value.length === 0) {
    throw new Error(`Required environment variable is missing: ${name}`);
  }

  return value;
};

const optionalEnv = (name: string, env: NodeJS.ProcessEnv): string | null => {
  const value = env[name]?.trim();
  return typeof value === 'undefined' || value.length === 0 ? null : value;
};

const parsePort = (rawPort: string): number => {
  if (!/^[0-9]+$/.test(rawPort)) {
    throw new RangeError(`MCSC_WEB_PORT must be an integer: ${rawPort}`);
  }

  const port = Number(rawPort);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RangeError(`MCSC_WEB_PORT is outside 1-65535: ${rawPort}`);
  }

  return port;
};

const parseBoolean = (name: string, rawValue: string): boolean => {
  if (rawValue === 'true') return true;
  if (rawValue === 'false') return false;

  throw new TypeError(`${name} must be exactly "true" or "false".`);
};

const isLoopbackHost = (host: string): boolean => {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
};

export const loadMCSCWebConfig = (
  env: NodeJS.ProcessEnv = process.env,
): MCSCWebConfig => {
  const host = requireEnv('MCSC_WEB_HOST', env);
  const port = parsePort(requireEnv('MCSC_WEB_PORT', env));
  const certificateFile = optionalEnv('MCSC_TLS_CERT_FILE', env);
  const privateKeyFile = optionalEnv('MCSC_TLS_KEY_FILE', env);
  if ((certificateFile === null) !== (privateKeyFile === null)) {
    throw new Error('MCSC_TLS_CERT_FILE and MCSC_TLS_KEY_FILE must either both be set or both be empty.');
  }
  const tls = certificateFile === null || privateKeyFile === null
    ? null
    : Object.freeze({ certificateFile: resolve(certificateFile), privateKeyFile: resolve(privateKeyFile) });
  const secret = requireEnv('MCSC_SESSION_SECRET', env);
  const directory = resolve(requireEnv('MCSC_SESSION_DIR', env));
  const secureCookie = parseBoolean(
    'MCSC_COOKIE_SECURE',
    requireEnv('MCSC_COOKIE_SECURE', env),
  );
  const parseTrustProxy = (rawValue: string): MCSCTrustProxy => {
    switch (rawValue) {
      case 'false':
        return false;
      case 'true':
        throw new TypeError('MCSC_TRUST_PROXY=true is forbidden. Specify a proxy address or subnet.');
      default:
        return rawValue;
    }
  };

  const originUrl = new URL(requireEnv('MCSC_WEB_ORIGIN', env));
  if (!['http:', 'https:'].includes(originUrl.protocol)
    || originUrl.pathname !== '/'
    || originUrl.search.length > 0
    || originUrl.hash.length > 0) throw new TypeError('MCSC_WEB_ORIGIN must be an HTTP(S) origin only.');

  const username = requireEnv('MCSC_ADMIN_USERNAME', env);
  const passHash = requireEnv('MCSC_ADMIN_PASSWORD_HASH', env);
  if (/[\u0000-\u001F\u007F]/.test(username) || username.length > 64) throw new TypeError('MCSC_ADMIN_USERNAME is invalid');
  if (!/^\$argon2(?:id|i|d)\$/.test(passHash)) throw new TypeError('MCSC_ADMIN_PASSWORD_HASH must be an Argon 2 hash.');

  if (!secureCookie) {
    if (!isLoopbackHost(host)) throw new Error('MCSC_COOKIE_SECURE=false is permitted only for localhost / loopback hosts.');
    if (originUrl.protocol !== 'http:') throw new Error('MCSC_COOKIE_SECURE=false requires an http:// MCSC_WEB_ORIGIN.');
  }
  if (tls !== null && originUrl.protocol !== 'https:') {
    throw new Error('Direct TLS requires an https:// MCSC_WEB_ORIGIN.');
  }

  return Object.freeze({
    origin: originUrl.origin,
    http: Object.freeze({ host, port }),
    tls,
    session: Object.freeze({ secret, directory, secureCookie }),
    initialAdmin: Object.freeze({ username, passHash }),
    trustProxy: parseTrustProxy(requireEnv('MCSC_TRUST_PROXY', env)),
  });
};
