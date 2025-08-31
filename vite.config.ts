import { defineConfig } from 'vite'
import { existsSync, watch } from 'fs'
import { resolve } from 'path'

// Viteプラグイン: sketches.jsonの変更を監視して自動リロード
const sketchesJsonWatcher = () => ({
  name: 'sketches-json-watcher',
  configureServer(server) {
    const sketchesJsonPath = resolve(process.cwd(), 'public/sketches.json')
    
    // sketches.jsonの変更を監視
    let isFirstLoad = true
    const watcher = watch(sketchesJsonPath, (eventType) => {
      if (eventType === 'change') {
        console.log('✅ sketches.json が更新されました - ページをリロードします')
        
        // 初回読み込み時、または通常の更新時にリロード
        setTimeout(() => {
          server.ws.send({
            type: 'full-reload'
          })
        }, isFirstLoad ? 1000 : 100) // 初回は少し待つ
        
        isFirstLoad = false
      }
    })
    
    // サーバー終了時にwatcherをクリーンアップ
    server.httpServer?.on('close', () => {
      watcher.close()
    })
  }
})

export default defineConfig({
  resolve: {
    extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json']
  },
  server: {
    open: true,
    fs: {
      allow: ['..']
    }
  },
  build: {
    target: 'esnext',
    modulePreload: false
  },
  plugins: [
    sketchesJsonWatcher()
  ]
}) 