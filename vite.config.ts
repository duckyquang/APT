import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' https://api.anthropic.com https://*.supabase.co",
  "img-src 'self' blob: data: https://*.supabase.co https://raw.githubusercontent.com",
  "frame-src https://www.youtube-nocookie.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

export default defineConfig(({ command }) => ({
  base: '/APT/',
  plugins: [
    react(),
    {
      name: 'csp',
      transformIndexHtml: () =>
        command === 'build'
          ? [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head-prepend' as const }]
          : [],
    },
  ],
}))
