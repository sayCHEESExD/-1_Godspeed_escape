import { serverConfig } from '../config/serverConfig.js';
import { logger } from '../util/logger.js';
import { JsonStorage } from './JsonStorage.js';
import { MongoStorage } from './MongoStorage.js';
import type { ProfileStorage } from './Storage.js';

export type { ProfileStorage, StoredGrant } from './Storage.js';
export type { MigrationFields, ProfileFields, ProgressFields, StoredProfile } from './StoredProfile.js';
export { coerceProfile, emptyProgress, hasProgress, progressOf } from './StoredProfile.js';

/**
 * THE ONE PLACE a concrete store is chosen.
 *
 * `MONGODB_URI` set (every Legion pod) -> MongoDB, the database in the URI.
 * Unset (a laptop, the verification scripts) -> the JSON files in the data
 * directory. Everything above this boundary holds a `ProfileStorage` and
 * knows no more than that.
 */
const create = (): ProfileStorage => {
  if (serverConfig.mongoUri) return new MongoStorage(serverConfig.mongoUri, serverConfig.dataDir);
  logger.info('persistence', `MONGODB_URI is not set: using the JSON store in ${serverConfig.dataDir}`);
  return new JsonStorage(serverConfig.dataDir);
};

export const storage: ProfileStorage = create();

/** The exit path's last resort, for the JSON store only; Mongo writes are awaited in shutdown. */
export const flushStorageSync = (): void => {
  if (storage instanceof JsonStorage) storage.flushSync();
};
