import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the API is proxied, so the browser sees one origin and no CORS setup is needed.
// The scoreboard's Socket.io connection is proxied too, with ws so it can upgrade.
const apiProxy = {
  '/api': 'http://localhost:4000',
  '/socket.io': { target: 'http://localhost:4000', ws: true },
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: true, proxy: apiProxy },
  preview: { port: 5174, strictPort: true, proxy: apiProxy },
});
