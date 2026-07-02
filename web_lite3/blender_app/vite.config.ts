import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/static/blender-app/',
  plugins: [react()],
  build: {
    outDir: '../static/blender-app',
    emptyOutDir: true,
    manifest: true,
    chunkSizeWarningLimit: 1600,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:5174',
      '/uploads': 'http://127.0.0.1:5174',
      '/exports': 'http://127.0.0.1:5174',
    },
  },
})
