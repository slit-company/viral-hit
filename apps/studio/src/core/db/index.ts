import { createDb } from './create-db';
import { appConfig } from '@/config';
import { getViralHitDatabaseUrl } from '@/config/data-root';

let dbInstance: any = null;

export async function db() {
  if (dbInstance) return dbInstance;

  const instance = createDb({
    database_url: process.env.VIRAL_HIT_DATA_DIR?.trim()
      ? getViralHitDatabaseUrl()
      : appConfig.database_url,
  }).catch((error) => { dbInstance = null; throw error; });

  dbInstance = instance;

  return instance;
}

export type { DbConfig } from './types';
export { createDb, closeDb } from './create-db';
