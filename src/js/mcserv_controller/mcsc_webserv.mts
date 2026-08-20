import { readFileSync } from 'fs';
import { createServer as createHTTPServer, type Server as HTTPServer } from 'http';
import { createServer as createHTTPSServer, type Server as HTTPSServer } from 'https';
import { type Express } from 'express';

export type MCSCHTTPServOpt = Readonly<{ host: string, port: number }>;
export type MCSCTLSOptions = Readonly<{
  certificateFile: string,
  privateKeyFile: string,
}>;
export type MCSCWebServer = HTTPServer | HTTPSServer;

/** Creates an HTTP server, or a directly TLS-terminating HTTPS server when TLS files are configured. */
export const createMCSCWebServ = (app: Express, tls: MCSCTLSOptions | null): MCSCWebServer => {
  if (tls === null) return createHTTPServer(app);

  return createHTTPSServer({
    cert: readFileSync(tls.certificateFile),
    key: readFileSync(tls.privateKeyFile),
    minVersion: 'TLSv1.2',
  }, app);
};

export const listenMCSCWebServ = (server: MCSCWebServer, options: MCSCHTTPServOpt): Promise<void> => {
  const { host, port } = options;
  if (host.trim().length === 0) return Promise.reject(new RangeError('web server host must not be empty'));

  if (!Number.isInteger(port) || !(port >= 1 && port <= 65535)) return Promise.reject(new RangeError(`Invalid web server port: ${port}`));

  if (server.listening) return Promise.reject(new Error('Web Server is Already LISTENING!'));

  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };

    const onListening = ():void => {
      server.off('error', onError);
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ host, port });
  });
}

export const closeMCSCWebServ = (server: MCSCWebServer): Promise<void> => {
  if (!server.listening) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
};
