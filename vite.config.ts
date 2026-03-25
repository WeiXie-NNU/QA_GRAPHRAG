import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { Connect, Plugin, PreviewServer, ViteDevServer } from 'vite'
import { resolve } from 'node:path'
import fs from 'node:fs'
const ROOT_DIR = process.cwd()

// 自定义插件：将 .geojson 文件作为 JSON 模块导入
function geojsonPlugin(): Plugin {
  return {
    name: 'vite-plugin-geojson',
    transform(code: string, id: string) {
      if (id.endsWith('.geojson')) {
        return {
          code: `export default ${code}`,
          map: null,
        }
      }
    },
  }
}

// 知识图谱路径映射
const KG_PATHS: Record<string, string> = {
  prosail: 'resources/repositories/PROSAIL/kg/output',
  lue: 'resources/repositories/LUE/kg/output',
}

// 自定义插件：提供多个知识图谱目录的静态文件服务
function serveKgData(): Plugin {
  return {
    name: 'serve-kg-data',
    configureServer(server: ViteDevServer) {
      // 处理 /kg-data/{kgId}/{filename} 格式的请求
      server.middlewares.use('/kg-data', (req, res, next) => {
        const reqUrl = req.url ?? ''
        const urlParts = reqUrl.slice(1).split('/')
        const kgId = urlParts[0]
        const fileName = urlParts.slice(1).join('/')
        
        console.log(`[KG Data] Request: ${reqUrl}, kgId: ${kgId}, fileName: ${fileName}`)
        
        // 特殊处理：目录扫描请求
        if (fileName === '_list_files') {
          const kgPath = KG_PATHS[kgId]
          if (!kgPath) {
            res.statusCode = 404
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: `Knowledge graph not found: ${kgId}` }))
            return
          }
          
          const dirPath = resolve(ROOT_DIR, kgPath)
          console.log(`[KG Data] Scanning directory: ${dirPath}`)
          
          if (fs.existsSync(dirPath)) {
            try {
              const files = fs.readdirSync(dirPath)
                .filter((file: string) => file.endsWith('.parquet'))
                .map((file: string) => {
                  const filePath = resolve(dirPath, file)
                  const stats = fs.statSync(filePath)
                  return {
                    name: file,
                    size: stats.size,
                    mtime: stats.mtime
                  }
                })
              
              console.log(`[KG Data] Found ${files.length} parquet files in ${kgId}`)
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ files }))
            } catch (error) {
              console.error(`[KG Data] Error scanning directory: ${error}`)
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'Directory scan error' }))
            }
          } else {
            console.log(`[KG Data] Directory not found: ${dirPath}`)
            res.statusCode = 404
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Directory not found' }))
          }
          return
        }
        
        // 查找对应的知识图谱路径
        const kgPath = KG_PATHS[kgId]
        if (!kgPath) {
          console.log(`[KG Data] No path found for kgId: ${kgId}`)
          res.statusCode = 404
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: `Knowledge graph not found: ${kgId}` }))
          return
        }
        
        const filePath = resolve(ROOT_DIR, kgPath, fileName)
        console.log(`[KG Data] Trying path: ${filePath}`)
        
        if (fs.existsSync(filePath)) {
          try {
            const content = fs.readFileSync(filePath)
            console.log(`[KG Data] File found, size: ${content.length} bytes`)
            res.setHeader('Content-Type', 'application/octet-stream')
            res.setHeader('Content-Length', content.length.toString())
            res.end(content)
          } catch (error) {
            console.error(`[KG Data] Error reading file: ${error}`)
            res.statusCode = 500
            res.end('File read error')
          }
        } else {
          console.log(`[KG Data] File not found: ${filePath}`)
          next()
        }
      })
    },
  }
}

// 自定义插件：提供 resources 目录的静态文件服务
function serveResources(): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const reqUrl = req.url ?? ''
    const filePath = resolve(ROOT_DIR, 'resources', reqUrl.slice(1))
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath)
      if (filePath.endsWith('.pdf')) {
        res.setHeader('Content-Type', 'application/pdf')
      } else if (filePath.endsWith('.csv')) {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      } else if (filePath.endsWith('.json') || filePath.endsWith('.geojson')) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
      } else {
        res.setHeader('Content-Type', 'application/octet-stream')
      }
      res.end(content)
    } else {
      next()
    }
  }

  return {
    name: 'serve-resources',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/resources', middleware)
    },
    configurePreviewServer(server: PreviewServer) {
      server.middlewares.use('/resources', middleware)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [geojsonPlugin(), react(), serveKgData(), serveResources()],
  build: {
    cssCodeSplit: true,
    modulePreload: false,
    rollupOptions: {
      output: {
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          const normalizedId = id.split('\\').join('/')

          if (id.includes('vite/preload-helper')) {
            return 'vendor-preload'
          }

          if (
            normalizedId.includes('/src/components/graphrag-viewer/') ||
            normalizedId.endsWith('/src/pages/GraphPage.tsx')
          ) {
            return 'app-graph'
          }

          if (
            normalizedId.includes('/src/components/chat/') ||
            normalizedId.endsWith('/src/App.tsx') ||
            normalizedId.endsWith('/src/contexts/AgentContext.tsx')
          ) {
            return 'app-chat'
          }

          if (
            normalizedId.endsWith('/src/components/sidebar/RightPanel.tsx') ||
            normalizedId.endsWith('/src/components/MapView.tsx') ||
            normalizedId.endsWith('/src/components/CaseDetailSidebar.tsx')
          ) {
            return 'app-right-panel'
          }

          if (normalizedId.endsWith('/src/contexts/DrawerContext.tsx')) {
            return 'app-drawer'
          }

          if (!id.includes('node_modules')) {
            return undefined
          }

          if (id.includes('mermaid')) {
            return 'vendor-mermaid'
          }

          if (
            id.includes('react-force-graph-3d') ||
            id.includes('/three/') ||
            id.includes('three-spritetext') ||
            id.includes('CSS2DRenderer')
          ) {
            return 'vendor-graph-3d'
          }

          if (
            id.includes('react-force-graph-2d') ||
            id.includes('d3-force-3d') ||
            id.includes('canvas-force-graph')
          ) {
            return 'vendor-graph-2d'
          }

          if (
            id.includes('hyparquet') ||
            id.includes('fuse.js')
          ) {
            return 'vendor-graph-data'
          }

          if (id.includes('cytoscape')) {
            return 'vendor-graph'
          }

          if (
            id.includes('react-markdown') ||
            id.includes('remark-gfm')
          ) {
            return 'vendor-markdown'
          }

          if (
            id.includes('react-syntax-highlighter') ||
            id.includes('/prismjs/') ||
            id.includes('/refractor/')
          ) {
            return 'vendor-code'
          }

          if (
            id.includes('@copilotkit') ||
            id.includes('@copilotkitnext') ||
            id.includes('@radix-ui') ||
            id.includes('@floating-ui') ||
            id.includes('class-variance-authority') ||
            id.includes('tailwind-merge') ||
            id.includes('/clsx/') ||
            id.includes('/zod/') ||
            id.includes('/uuid/') ||
            id.includes('partial-json') ||
            id.includes('lucide-react')
          ) {
            return 'vendor-copilot'
          }

          if (id.includes('react-dropzone')) {
            return 'vendor-case'
          }

          if (id.includes('@tanstack/react-query')) {
            return 'vendor-query'
          }

          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/scheduler/')
          ) {
            return 'vendor-react'
          }

          return undefined
        },
      },
    },
  },
  server: {
    host: '0.0.0.0', // 监听所有网络接口，支持局域网访问
    port: 3000,
    proxy: {
      // 代理 API 请求到后端 8090 端口
      '/api': {
        target: 'http://127.0.0.1:8090',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
