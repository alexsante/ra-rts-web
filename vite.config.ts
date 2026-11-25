import { defineConfig } from 'vite';
import { multiplayerRelayPlugin } from './src/net/wsRelayPlugin';

export default defineConfig({
  plugins: [multiplayerRelayPlugin()],
  server: {
    host: true,
    port: 5173,
    open: false,
    allowedHosts: true,
  },
  preview: {
    host: true,
    port: 4173,
    allowedHosts: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
