import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['planner-mark.svg'],
      manifest: {
        name: 'Nowline · 목표를 실행으로',
        short_name: 'Nowline',
        description: '연간 목표부터 오늘의 시간 블록과 실행 근거까지 연결하는 개인 플래너',
        theme_color: '#f5f6f8',
        background_color: '#f5f6f8',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        lang: 'ko',
        icons: [
          {
            src: '/planner-mark.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        importScripts: ['/push-handler.js']
      }
    })
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true
      }
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: true
  }
});
