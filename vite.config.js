import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, proxy /api/* to the Express backend (npm run server, port 8787) so the
// frontend and API share an origin (no CORS). In production you deploy the static
// build + the backend behind the same domain. See README.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
