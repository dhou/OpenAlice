import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  test: {
    include: ['src/**/*.e2e.spec.*'],
    testTimeout: 60_000,
    fileParallelism: false,  // e2e tests share exchange APIs — run sequentially
  },
})
