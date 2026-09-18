import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ROOM_NAME } from '@godspeed/shared';
import { serverConfig } from './config/serverConfig.js';
import { createHttpServer } from './httpServer.js';
import { flushStorageSync } from './persistence/index.js';
import { profileStore } from './progression/ProfileStore.js';
import { CourseRoom } from './rooms/CourseRoom.js';
import { logger } from './util/logger.js';

const SCOPE = 'server';

/** Longest a shutdown waits for queued saves before going anyway. */
const FLUSH_TIMEOUT_MS = 20_000;

const boot = async (): Promise<void> => {
  // Open the store BEFORE listening. This never throws: a database that is
  // down is logged loudly and joins are refused until it is back, while
  // /health keeps answering so the host does not restart-loop the pod.
  await profileStore.open();

  const gameServer = new Server({
    transport: new WebSocketTransport({ server: createHttpServer() }),
    greet: false,
  });

  gameServer.define(ROOM_NAME, CourseRoom);

  await gameServer.listen(serverConfig.port, serverConfig.host);
  logger.info(
    SCOPE,
    `listening on ${serverConfig.host}:${serverConfig.port} ` +
      `room="${ROOM_NAME}" health=/health storage=${profileStore.kind} game=${serverConfig.gameSlug}`,
  );

  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logger.info(SCOPE, `received ${signal}, shutting down`);
    void (async () => {
      try {
        // `false`: do NOT let Colyseus exit the process - the saves that
        // disconnecting every client queued still have to land first.
        await gameServer.gracefullyShutdown(false);
      } catch (error) {
        logger.error(SCOPE, 'graceful shutdown failed:', error);
      }
      const landed = await profileStore.flush(FLUSH_TIMEOUT_MS);
      if (!landed) logger.error(SCOPE, 'some saves were still outstanding at the flush deadline');
      await profileStore.close().catch((error: unknown) => logger.error(SCOPE, 'store close failed:', error));
      logger.info(SCOPE, 'stopped');
      process.exit(0);
    })();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
};

// A last resort for any exit path that skipped the handler above. The JSON
// store writes synchronously here; Mongo writes are awaited in `shutdown`.
process.on('exit', () => flushStorageSync());

boot().catch((error: unknown) => {
  logger.error(SCOPE, 'failed to start', error);
  process.exit(1);
});
