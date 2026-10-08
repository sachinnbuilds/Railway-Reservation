import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { handleRailwayApi } from './src/server/railwayBackend.ts';

function railwayApiPlugin() {
  return {
    name: 'railway-api-plugin',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // If standalone mode or mock enabled, handle in-process
        if (process.env.VITE_USE_MOCK === 'true') {
          if (req.url && req.url.startsWith('/api')) {
            return handleRailwayApi(req, res, next);
          }
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), railwayApiPlugin()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:9080',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});



