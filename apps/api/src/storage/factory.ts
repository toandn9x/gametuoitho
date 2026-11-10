import type { Bindings } from '../types';
import { R2StorageDriver, type StorageDriver } from './storage';
import { TigrisStorageDriver } from './tigris';

export function createCloudStorage(env: Bindings): StorageDriver {
  // Preserve existing R2 deployments when they have not set STORAGE_PROVIDER.
  const provider = env.STORAGE_PROVIDER || (env.BUCKET ? 'r2' : 'tigris');
  if (provider === 'r2') {
    if (!env.BUCKET) throw new Error('STORAGE_PROVIDER=r2 cần binding BUCKET');
    return new R2StorageDriver(env.BUCKET);
  }
  if (provider !== 'tigris') throw new Error('STORAGE_PROVIDER phải là tigris hoặc r2');
  return new TigrisStorageDriver({
    endpoint: env.TIGRIS_ENDPOINT || 'https://t3.storage.dev',
    bucket: env.TIGRIS_BUCKET || '',
    accessKeyId: env.TIGRIS_ACCESS_KEY_ID || '',
    secretAccessKey: env.TIGRIS_SECRET_ACCESS_KEY || '',
    region: env.TIGRIS_REGION || 'auto',
    allowLocalHttp: env.ENVIRONMENT === 'test' || env.ENVIRONMENT === 'development',
  });
}
