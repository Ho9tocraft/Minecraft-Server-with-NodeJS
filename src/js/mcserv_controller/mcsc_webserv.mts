import { createServer, Server } from 'http';
import { type Express } from 'express';

export type MCSCHTTPServOpt = Readonly<{ host: string, port: number }>;

export const createMCSCHTTPServ = (app: Express): Server => {
  return createServer(app);
};

export const listenMCSCHTTPServ = (server: Server, options: MCSCHTTPServOpt): Promise<void> => {
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

export const closeMCSCHTTPServ = (server: Server): Promise<void> => {
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
