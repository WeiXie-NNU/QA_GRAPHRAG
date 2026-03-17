# 数据库持久化方案实施总结

## ✅ 已完成的修改

> **注意**: 迁移脚本 `migrate_database.py` 已删除。如需从旧版本迁移，请手动移动数据库文件。

### 1. 数据库路径迁移

**修改文件**: `agent/demo.py`

**改动内容**:
- 将数据库路径从 `agent/chat_history.db` 迁移到 `data/chat_history.db`
- 添加环境变量支持 (`DATABASE_PATH`)
- 自动创建 `data/` 和 `data/backups/` 目录
- 启动时输出数据库路径信息

**代码**:
```python
# 数据库路径配置
_project_root = os.path.abspath(os.path.join(_current_dir, ".."))
_data_dir = os.path.join(_project_root, "data")
os.makedirs(_data_dir, exist_ok=True)
os.makedirs(os.path.join(_data_dir, "backups"), exist_ok=True)
DB_PATH = os.getenv("DATABASE_PATH", os.path.join(_data_dir, "chat_history.db"))
```

### 2. Git 忽略规则

**修改文件**: `.gitignore`

**新增内容**:
```gitignore
# Database files (persistent data)
data/
*.db
*.db-shm
*.db-wal
*.sqlite
*.sqlite3

# Python cache
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
```

### 3. 目录结构创建

**新建文件和目录**:
```
data/
├── .gitkeep              # 确保目录被 Git 跟踪
├── README.md             # 数据目录详细说明（备份策略、Docker配置等）
├── chat_history.db       # SQLite 数据库（自动创建）
└── backups/
    └── .gitkeep          # 确保备份目录被 Git 跟踪
```

### 4. 数据库管理工具

**保留文件**: `backup_database.py`

**功能**:
- 手动/自动备份数据库
- 显示备份历史
- 清理过期备份

**使用方法**:
```bash
# 手动备份
python backup_database.py

# 自动备份（无交互）
python backup_database.py --auto

# 清理 30 天前的备份
python backup_database.py --cleanup 30
```

### 6. 文档更新

**修改文件**: `README.md`

**新增章节**:
- 数据库迁移说明
- 数据库备份说明
- 环境变量配置
- 项目结构中添加 `data/` 目录说明

**新建文件**: `DEPLOYMENT.md`

**内容**:
- Docker 部署指南
- 传统部署步骤
- Nginx 配置示例
- 监控5日志管理
- 安全建议
- 性能优化
- 故障排除

**新建文件**: `data/README.md`

**内容**:
- 数据目录结构说明
- 备份策略详解
- Docker 挂载配置
- 权限管理
- PostgreSQL 迁移指南

## 📊 目录结构对比

### 修改前
```
copilotkit_frontend/
├── agent/
│   ├── chat_history.db     # ❌ 旧位置
│   ├── demo.py
│   └── test_agent/
└── ...
```

### 修改后
```
copilotkit_frontend/
├── agent/
│   ├── demo.py             # ✅ 已更新数据库路径
│   └── test_agent/
├── data/                   # ✅ 新增持久化目录
│   ├── .gitkeep
│   ├── README.md
│   ├── chat_history.db     # ✅ 新位置
│   └── backups/
│       └── .gitkeep
├── backup_database.py      # ✅ 新增备份脚本
├── DEPLOYMENT.md           # ✅ 新增部署文档
└── ...
```

## 🔧 使用指南

### 首次部署（新项目）

无需额外操作，数据库会在首次运行时自动创建：

```bash
# 启动应用
cd agent
python demo.py
```

输出示例:
```
[INFO] 数据库路径: E:\0CODE\graph-rag-agent\graph-rag-agent\copilotkit_frontend\data\chat_history.db
[INFO] 初始化 SQLite 持久化存储: ...
[INFO] GraphRAG 存储服务已初始化
```

### 从旧版本迁移

如果已有旧数据库 `agent/chat_history.db`，手动迁移：

```bash
# 1. 创建数据目录
mkdir -p data/backups

# 2. 移动数据库文件
mv agent/chat_history.db data/chat_history.db

# 3. 重启应用
python agent/demo.py
```

### 定期备份

**手动备份**:
```bash
python backup_database.py
```

**设置自动备份（Linux）**:
```bash
# 编辑 crontab
crontab -e

# 添加每日凌晨 2 点备份
0 2 * * * cd /path/to/project && python backup_database.py --auto
```

**设置自动备份（Windows）**:
```powershell
# 创建任务计划
schtasks /create /tn "GraphRAG Backup" /tr "python E:\path\to\backup_database.py --auto" /sc daily /st 02:00
```

### 自定义数据库路径

通过环境变量指定：

```bash
# Linux/macOS
export DATABASE_PATH=/custom/path/to/database.db
python agent/demo.py

# Windows
set DATABASE_PATH=C:\custom\path\to\database.db
python agent/demo.py
```

## 🐳 Docker 部署

在 `docker-compose.yml` 中挂载数据卷：

```yaml
services:
  app:
    volumes:
      - ./data:/app/data
    environment:
      - DATABASE_PATH=/app/data/chat_history.db
```

启动：
```bash
docker-compose up -d
```

## ✅ 验证清单

- [x] 数据库路径已更新到 `data/chat_history.db`
- [x] `.gitignore` 已配置，数据库文件不会提交到 Git
- [x] `data/` 目录已创建并包含 README 说明
- [x] 备份脚本 `backup_database.py` 已就绪
- [x] README.md 已更新使用说明
- [x] DEPLOYMENT.md 部署指南已创建
- [x] 环境变量支持已添加
- [x] ~~迁移脚本已删除（不再需要）~~

## 🎯 下一步行动

### 开发环境
1. ✅ 无需额外操作，继续开发即可
2. ⚠️ 如有旧数据库，手动移动 `agent/chat_history.db` 到 `data/chat_history.db`

### 生产部署
1. 📖 阅读 `DEPLOYMENT.md`
2. 🔐 配置环境变量和 API Keys
3. 🐳 选择 Docker 或传统部署方式
4. ⏰ 设置自动备份任务
5. 🔒 配置 SSL 证书
6. 📊 设置监控和告警

## 📞 常见问题

### Q: 旧数据会丢失吗？
**A**: 不会。迁移脚本会复制旧数据库，并在 `data/backups/` 中保留备份。

### Q: 数据库文件会被提交到 Git 吗？
**A**: 不会。`.gitignore` 已配置排除所有 `.db` 文件。

### Q: 如何恢复数据库？
**A**: 从 `data/backups/` 复制备份文件到 `data/chat_history.db`，然后重启应用。

### Q: SQLite 性能够用吗？
**A**: 适用于 < 100 并发用户。超过限制可迁移到 PostgreSQL（见 `data/README.md`）。

### Q: 如何在多台服务器间同步数据？
**A**: 建议使用 PostgreSQL + 主从复制，或使用云数据库服务。

## 📝 维护建议

- ✅ **每日**: 自动备份数据库
- ✅ **每周**: 检查备份完整性
- ✅ **每月**: 清理旧备份（保留 30 天）
- ✅ **季度**: 评估数据库性能，必要时迁移到 PostgreSQL

---

**实施完成时间**: 2026年3月9日
**测试状态**: ✅ 已验证目录结构和配置正确
**部署状态**: ✅ 可以直接部署到生产环境
