# GraphRAG 智能问答前端

基于 **React** + **TypeScript** + **CopilotKit** 构建的知识图谱增强问答系统前端。

## 技术栈

- **React 18.2.0** - UI 框架
- **TypeScript** - 类型安全
- **Vite** - 构建工具
- **CopilotKit** - AI 对话框架
- **Leaflet** - 地图可视化

## 项目结构

```
copilotkit_frontend/
├── src/                          # 源代码目录
│   ├── App.tsx                   # 主应用组件（入口）
│   ├── App.css                   # 全局样式
│   ├── main.tsx                  # 应用入口点
│   │
│   ├── lib/                      # 库文件
│   │   ├── consts.ts             # 常量配置（API 地址、Agent 类型等）
│   │   ├── utils.ts              # 工具函数（消息解析、防抖等）
│   │   └── types.ts              # TypeScript 类型定义
│   │
│   ├── components/               # 组件目录
│   │   ├── progress/             # 进度显示组件
│   │   │   ├── ProgressDisplay.tsx    # 任务进度条
│   │   │   ├── ProgressDisplay.css
│   │   │   └── index.ts
│   │   │
│   │   ├── geo/                  # 地理可视化组件
│   │   │   ├── GeoVisualization.tsx   # 地理坐标点展示
│   │   │   ├── GeoVisualization.css
│   │   │   └── index.ts
│   │   │
│   │   ├── chat/                 # 聊天组件
│   │   │   ├── ChatArea.tsx      # 聊天区域（消息列表、输入框）
│   │   │   ├── ChatArea.css
│   │   │   ├── AssistantMessage.tsx   # AI 消息渲染器
│   │   │   ├── AssistantMessage.css
│   │   │   └── index.ts
│   │   │
│   │   ├── sidebar/              # 侧边栏组件
│   │   │   ├── Sidebar.tsx       # 侧边栏（线程管理、模型选择）
│   │   │   ├── Sidebar.css
│   │   │   └── index.ts
│   │   │
│   │   ├── MapView.tsx           # 地图视图组件
│   │   ├── MapView.css
│   │   ├── MapPanel.tsx          # 地图面板组件
│   │   ├── MapPanel.css
│   │   ├── CaseDetailSidebar.tsx # 案例详情侧边栏
│   │   ├── CaseDetailSidebar.css
│   │   ├── TaskProgress.tsx      # 任务进度（旧版）
│   │   ├── TaskProgress.css
│   │   └── index.ts              # 组件导出入口
│   │
│   ├── services/                 # 服务层
│   │   └── threadService.ts      # 线程管理服务（历史消息、状态持久化）
│   │
│   ├── hooks/                    # 自定义 Hooks
│   │   └── useTestAgent.tsx      # Test Agent 状态 Hook
│   │
│   └── assets/                   # 静态资源
│
├── agent/                        # Python Agent 代码
│   ├── test_agent/               # 测试智能体
│   │   ├── graph_rag/            # Graph RAG 实现
│   │   └── ...
│   └── inference_agent/          # 推理智能体
│
├── runtime/                      # CopilotKit Runtime 服务
│   ├── server.ts                 # 服务入口
│   └── package.json
│
├── data/                         # 📁 持久化数据目录（生产环境）
│   ├── README.md                 # 数据目录说明文档
│   ├── chat_history.db           # SQLite 数据库（对话历史、GraphRAG 结果）
│   └── backups/                  # 数据库备份目录
│       └── chat_history_*.db     # 历史备份文件
│
├── public/                       # 公共资源
├── resources/                    # 用户访问的静态资源（CSV、GeoJSON、PDF等）
├── dist/                         # 构建输出
├── backup_database.py            # 🔧 数据库备份脚本
├── package.json
├── vite.config.ts
├── tsconfig.json
└── README.md
```

## 组件说明

### 核心组件

| 组件 | 路径 | 说明 |
|-----|------|------|
| `App` | `src/App.tsx` | 主应用，组合所有顶层组件 |
| `Sidebar` | `src/components/sidebar/` | 侧边栏，包含线程管理、LLM 选择、Agent 切换 |
| `ChatArea` | `src/components/chat/` | 聊天区域，处理消息展示和用户输入 |
| `AssistantMessage` | `src/components/chat/` | AI 消息渲染器，解析特殊标记 |

### 可视化组件

| 组件 | 路径 | 说明 |
|-----|------|------|
| `ProgressDisplay` | `src/components/progress/` | 任务执行进度条 |
| `GeoVisualization` | `src/components/geo/` | 地理坐标点地图展示 |
| `MapView` | `src/components/MapView.tsx` | 基于地址的地图视图 |
| `CaseDetailSidebar` | `src/components/CaseDetailSidebar.tsx` | 案例详情侧边栏 |

### 服务层

| 服务 | 路径 | 说明 |
|-----|------|------|
| `threadService` | `src/services/threadService.ts` | 线程 CRUD、历史消息加载、Agent 状态持久化 |

### 配置文件

| 文件 | 路径 | 说明 |
|-----|------|------|
| `consts.ts` | `src/lib/consts.ts` | API 地址、Agent 类型、聊天配置 |
| `utils.ts` | `src/lib/utils.ts` | 消息解析、工具函数 |
| `types.ts` | `src/lib/types.ts` | TypeScript 类型定义 |

## 快速开始

### 数据库备份

定期备份数据库（推荐）：

```bash
# 手动备份
python backup_database.py

# 自动备份（无需确认）
python backup_database.py --auto

# 清理 30 天前的旧备份
python backup_database.py --cleanup 30
```

备份文件保存在 `data/backups/` 目录。

### 历史消息迁移

如果项目里已经有大量旧线程，但这些线程还没有写入 `thread_messages` 消息日志表，建议先执行一次离线迁移：

```bash
# 先看迁移覆盖率
.venv\Scripts\python agent\migrate_thread_messages.py --stats-only

# 迁移所有缺失消息日志的线程
.venv\Scripts\python agent\migrate_thread_messages.py

# 仅迁移部分线程
.venv\Scripts\python agent\migrate_thread_messages.py --thread-id <thread_id>

# 重新强制回填已存在的线程
.venv\Scripts\python agent\migrate_thread_messages.py --force --limit 20
```

运行中的服务也可以查看迁移覆盖率：

```bash
GET /admin/thread-messages/stats
```

### 环境变量配置（可选）

自定义数据库路径：

```bash
# Linux/macOS
export DATABASE_PATH=/custom/path/to/database.db

# Windows
set DATABASE_PATH=C:\custom\path\to\database.db
```

### 安装依赖

```bash
cd copilotkit_frontend
npm install
```

### Python 后端环境（推荐 `uv`）

```bash
# 项目根目录执行
uv python install 3.11
uv venv --python 3.11 .venv
uv sync
```

启动后端时使用：

```bash
.venv\Scripts\python agent\demo.py
```

### 启动开发服务器

```bash
npm run dev
```

### 启动 Runtime 服务

```bash
cd runtime
npm install
npm start
```

### 构建生产版本

```bash
npm run build
```

## Agent 类型

| Agent | 说明 |
|-------|------|
| `naive_rag` | 基础 RAG 检索 |
| `graph_rag` | 知识图谱增强 RAG |
| `inference` | 参数推理智能体 |
| `test` | 多步骤测试智能体 |

## LLM 支持

- GPT-4o / GPT-4o-mini / GPT-3.5-turbo
- Claude-3.5-sonnet / Claude-3-haiku
- Gemini-1.5-pro

## 端口配置

| 服务 | 端口 | 说明 |
|------|------|------|
| Frontend | 5173 | Vite 开发服务器 |
| Runtime | 4000 | CopilotKit Runtime |
| Agent API | 8089 | Python Agent 服务 |
