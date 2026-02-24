import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Proxy '/api/*' to backend running on http://127.0.0.1:3000
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api/, '/api')
      }
    }
  }
})
