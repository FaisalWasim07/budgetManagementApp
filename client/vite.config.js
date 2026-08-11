import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API port is fixed at 5000 in normal use. It is overridable so the browser
// tests can run their own server and client alongside a development one,
// without the two fighting over ports or over the database.
const apiPort = process.env.VITE_API_PORT || 5000;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': `http://localhost:${apiPort}`,
    },
  },
});
