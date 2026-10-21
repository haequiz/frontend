import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // sockjs-client 가 Node 의 global 을 찾는다
  define: { global: 'globalThis' },
  server: { port: 5173 },
});
