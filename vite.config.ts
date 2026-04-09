import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

// 构建时将 sw.js 里的版本号替换为当前时间戳，确保每次构建刷新缓存
function pwaPlugin() {
  return {
    name: 'pwa-sw-version',
    closeBundle() {
      const swDest = path.resolve(__dirname, 'dist/sw.js')
      if (fs.existsSync(swDest)) {
        const version = `v${Date.now()}`
        let content = fs.readFileSync(swDest, 'utf-8')
        content = content.replace(/const CACHE_VERSION = 'v\d*'/, `const CACHE_VERSION = '${version}'`)
        fs.writeFileSync(swDest, content)
        console.log(`[PWA] sw.js cache version updated to ${version}`)
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), pwaPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
