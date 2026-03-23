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
  resolve: {
    alias: {
      react: resolve(ROOT_DIR, 'node_modules/react'),
      'react-dom': resolve(ROOT_DIR, 'node_modules/react-dom'),
      'react/jsx-runtime': resolve(ROOT_DIR, 'node_modules/react/jsx-runtime.js'),
      'react/jsx-dev-runtime': resolve(ROOT_DIR, 'node_modules/react/jsx-dev-runtime.js'),
    },
    dedupe: ['react', 'react-dom'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined
          }

          if (id.includes('mermaid')) {
            return 'vendor-mermaid'
          }

          if (
            id.includes('react-force-graph') ||
            id.includes('three') ||
            id.includes('three-spritetext') ||
            id.includes('cytoscape')
          ) {
            return 'vendor-graph'
          }

          if (
            id.includes('react-syntax-highlighter') ||
            id.includes('/prismjs/') ||
            id.includes('/refractor/')
          ) {
            return 'vendor-code'
          }

          if (id.includes('@copilotkit')) {
            return 'vendor-copilot'
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
