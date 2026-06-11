import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// During local dev, proxy /api/chat to a local serverless emulator if you run one,
// otherwise the app falls back to the direct Anthropic endpoint (works inside the
// Claude.ai artifact sandbox). See README for deployment notes.
export default defineConfig({
  plugins: [react()],
})
