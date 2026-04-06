import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_FILE ?? './backend/data/app.db';

export default defineConfig({
  dialect: 'sqlite',
  schema: './backend/src/db/schema.ts',
  out: './backend/drizzle',
  dbCredentials: {
    url
  }
});
