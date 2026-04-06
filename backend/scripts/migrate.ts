import { databaseFile, sqlite } from '../src/db/client';
import { ensureDatabaseSchema } from '../src/db/setup';

ensureDatabaseSchema();

console.log(`SQLite schema is ready: ${databaseFile}`);

sqlite.close();
