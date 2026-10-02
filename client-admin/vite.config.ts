import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the API is proxied, so the browser sees one origin and no CORS setup is needed.
const apiProxy = { '/api': 'http://localhost:4000' };

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true, proxy: apiProxy },
  preview: { port: 5173, strictPort: true, proxy: apiProxy },
});
