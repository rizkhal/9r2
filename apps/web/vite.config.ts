import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// Must match API_PORT in scripts/dev.mjs.
const apiUrl = `http://127.0.0.1:${process.env.API_PORT ?? 8788}`

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': apiUrl,
      '/public': apiUrl,
      '/health': apiUrl,
    },
  },
})
