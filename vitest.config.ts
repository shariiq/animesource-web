import { defineConfig } from 'vitest/config'
import solid from 'vite-plugin-solid'

export default defineConfig({
  // hot: false disables the @solid-refresh HMR transform, which cannot resolve
  // its virtual module outside a Vite dev pipeline (i.e. under Vitest).
  plugins: [solid({ hot: false })],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
  },
})
