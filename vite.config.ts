import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { recipeFetchPlugin } from './server/recipe-fetch-plugin'
import { serializeIngredientCatalog } from './src/domain/ingredientCatalogExport'

/**
 * Emits the public ingredient catalogue from the single source of truth in
 * src/domain/ingredientCatalogData.ts. No second, manually maintained catalogue
 * file is needed.
 */
function ingredientCatalogDownloadPlugin(): Plugin {
  return {
    name: 'kuechenrunde-ingredient-catalog-download',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'legal/ingredient-catalog.json',
        source: serializeIngredientCatalog(),
      })
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    recipeFetchPlugin(),
    ingredientCatalogDownloadPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Küchenrunde',
        short_name: 'Küchenrunde',
        description: 'Rezepte, Wochenplan und Einkaufsliste für die Familie.',
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
        // `json` gehört in den Precache: Der Navigation-Fallback beantwortet
        // sonst auch direkte Aufrufe von /legal/ingredient-catalog.json mit
        // index.html. txt/webmanifest decken die übrigen verlinkten Dateien ab.
        globPatterns: ['**/*.{js,css,html,json,svg,png,ico,webmanifest,txt}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
