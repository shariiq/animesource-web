import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/solid-start/plugin/vite'
import solid from 'vite-plugin-solid'
import { nitro } from 'nitro/vite'

export default defineConfig({
  plugins: [
    tailwindcss(),
    tanstackStart({
      srcDirectory: 'app',
      router: { routesDirectory: 'routes' },
    }),
    nitro({
      preset: 'vercel',
      // hls.js is client-only (warmed on player mount, never executed during
      // SSR). Keep it out of the server function so the deployment stays lean.
      rollupConfig: { external: ['hls.js'] },
    }),
    solid({ ssr: true }),
  ],
})
