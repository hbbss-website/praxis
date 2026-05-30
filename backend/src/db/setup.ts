import fs from 'node:fs';
import path from 'node:path';

import { sql } from 'drizzle-orm';

import { db, sqlite } from './client';

let initialized = false;

const migrationsDir = path.resolve(process.cwd(), 'backend/drizzle');

export function ensureDatabaseSchema() {
  if (initialized) return;

  const dirs = fs.readdirSync(migrationsDir)
    .filter((name) => fs.statSync(path.join(migrationsDir, name)).isDirectory())
    .sort();

  for (const dir of dirs) {
    const migrationPath = path.join(migrationsDir, dir, 'migration.sql');

    if (!fs.existsSync(migrationPath)) continue;

    const statements = fs.readFileSync(migrationPath, 'utf-8')
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);

    const sqlContent = statements
      .map((stmt) => {
        if (/^CREATE\s+TABLE\s+/i.test(stmt)) {
          return stmt.replace(/^CREATE\s+TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS ');
        }
        if (/^CREATE\s+(UNIQUE\s+)?INDEX\s+/i.test(stmt)) {
          return stmt.replace(/^CREATE\s+(UNIQUE\s+)?INDEX\s+/i, (match) => match.replace('INDEX', 'INDEX IF NOT EXISTS'));
        }
        return stmt;
      })
      .join(';\n');

    sqlite.exec(sqlContent);
  }

  initialized = true;
}
