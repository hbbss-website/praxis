import path from 'node:path';

import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import { appConfig } from './backend/src/config';

const backendTarget = `http://${appConfig.backend_host}:${appConfig.port}`;

export default defineConfig({
  root: 'frontend',
  plugins: [react(), tailwindcss()],
  server: {
    host: appConfig.frontend_host,
    port: appConfig.vite_port,
    strictPort: true,
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true
      },
      '/uploads': {
        target: backendTarget,
        changeOrigin: true
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve('frontend/src')
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: 'oxc',
    sourcemap: false,
    cssMinify: true,
    modulePreload: {
      polyfill: true
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined;
          }

          if (id.includes('react-day-picker') || id.includes('date-fns')) {
            return 'calendar';
          }

          if (id.includes('@tanstack/react-table')) {
            return 'data-table';
          }

          if (id.includes('@radix-ui') || id.includes('/radix-ui/')) {
            return 'radix';
          }

          if (id.includes('react-router-dom')) {
            return 'router';
          }

          if (id.includes('react-dom') || id.includes('/react/')) {
            return 'react';
          }

          if (id.includes('lucide-react')) {
            return 'icons';
          }

          if (id.includes('sonner')) {
            return 'feedback';
          }

          return 'vendor';
        }
      }
    }
  }
});
