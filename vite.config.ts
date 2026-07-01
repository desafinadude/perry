import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 1234,
  },
  preview: {
    port: 1234,
    cors: true,
  },
})
