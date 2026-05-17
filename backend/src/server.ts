import { serve } from '@hono/node-server';

import { app } from './app';
import { appConfig } from './config';

const port = appConfig.port;
const hostname = appConfig.backend_host;

serve({
  fetch: app.fetch,
  port,
  hostname
});

console.log(`Server listening on http://${hostname}:${port}`);
