import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';

export function createD1DB(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type D1DB = ReturnType<typeof createD1DB>;
