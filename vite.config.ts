import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { recipeFetchPlugin } from './server/recipe-fetch-plugin'

export default defineConfig({
  plugins: [
    react(),
    recipeFetchPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'openCook Web',
        short_name: 'openCook',
        description: 'Lokale Rezeptbibliothek mit Mela-Import',
        lang: 'de',
        theme_color: '#0f1511',
        background_color: '#f2ecdf',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
