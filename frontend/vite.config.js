import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    port: 5174,
    // Dev: browser calls same-origin /api/* → forwards to FastAPI (avoids CORS / wrong-host issues).
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        // Vector RAG first request can load encoders + hit Pinecone + Ollama for minutes.
        timeout: 600000,
        proxyTimeout: 600000,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setTimeout(600000)
          })
        }
      }
    }
  }
})

