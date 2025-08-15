import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json']
  },
  server: {
    open: true,
    fs: {
      allow: ['..']
    }
  },
  build: {
    target: 'esnext',
    modulePreload: false
  }
}) 
