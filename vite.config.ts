import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages では https://<user>.github.io/kitagawa-anki/ に置くので、パスの起点をそこに合わせる
export default defineConfig({
  base: '/kitagawa-anki/',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png', 'favicon.png'],
      manifest: {
        name: 'KitagawaAnki',
        short_name: 'KitagawaAnki',
        description: 'FSRSで出題する暗記カード',
        lang: 'ja',
        start_url: '/kitagawa-anki/',
        scope: '/kitagawa-anki/',
        display: 'standalone',
        background_color: '#f6f5f1',
        theme_color: '#2f6f5e',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,png,svg}'] },
    }),
  ],
})
