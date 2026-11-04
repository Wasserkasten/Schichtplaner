import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Schichtplaner',
        short_name: 'Schichtplan',
        description: 'Dienst- und Abwesenheitsplanung',
        lang: 'de',
        theme_color: '#1f4e79',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // API-Aufrufe nie aus dem Cache bedienen – der Plan muss aktuell sein
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    port: 5173,
    // API-Port wie beim Server über PORT änderbar, z. B.: PORT=3001 npm run dev
    proxy: { '/api': { target: `http://localhost:${process.env.PORT ?? 3000}`, changeOrigin: false } },
  },
});
