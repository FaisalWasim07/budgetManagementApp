import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const here = path.dirname(fileURLToPath(import.meta.url));

// The API port is fixed at 5000 in normal use. It is overridable so the browser
// tests can run their own server and client alongside a development one,
// without the two fighting over ports or over the database.
const apiPort = process.env.VITE_API_PORT || 5000;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // The one alias in the app, and deliberately narrow: it exists only so
    // the vendored bklit chart source (client/src/vendor/bklit/**) resolves
    // its own "@/lib/utils" imports unmodified, exactly as bklit's own
    // registry would have written them. Nothing else in the app uses "@/" —
    // every other import here is relative, on purpose, and this alias is not
    // an invitation to start.
    alias: { '@': path.resolve(here, 'src/vendor/bklit') },
  },
  server: {
    proxy: {
      '/api': `http://localhost:${apiPort}`,
    },
  },
});
