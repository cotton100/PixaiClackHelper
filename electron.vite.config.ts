import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: { rollupOptions: { input: { index: resolve('src/main/pixai/desktop.ts') } } },
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: { build: { rollupOptions: { input: { index: resolve('src/preload/pixai.ts') } } } },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
