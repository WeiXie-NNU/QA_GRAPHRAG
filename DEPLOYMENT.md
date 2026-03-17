# 生产环境部署指南

本文档说明如何将项目部署到公网生产环境。

## 📋 部署前准备

### 1. 环境变量配置

创建 `.env` 文件（参考 `.env.example`）：

```bash
# API Keys
OPENAI_API_KEY=your_openai_key
GRAPHRAG_API_KEY=your_graphrag_key
OPENAI_API_BASE=https://api.openai.com/v1

# 数据库路径（可选）
DATABASE_PATH=/path/to/production/database.db
```

### 2. 数据备份策略

设置自动备份（推荐每日执行）：

**Linux/macOS (crontab):**
```bash
# 编辑 crontab
crontab -e

# 添加每日凌晨 2 点备份
0 2 * * * cd /path/to/project && python backup_database.py --auto
0 3 * * 0 cd /path/to/project && python backup_database.py --cleanup 30
```

**Windows (任务计划程序):**
```powershell
# 创建备份任务
schtasks /create /tn "GraphRAG Backup" /tr "python C:\path\to\backup_database.py --auto" /sc daily /st 02:00
```

## 🐳 Docker 部署（推荐）

### Dockerfile

```dockerfile
# Frontend
FROM node:18-alpine AS frontend-builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Backend
FROM python:3.10-slim
WORKDIR /app

# 安装依赖
COPY agent/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# 复制代码
COPY agent/ ./agent/
COPY resources/ ./resources/
COPY --from=frontend-builder /app/dist ./dist

# 创建数据目录
RUN mkdir -p /app/data/backups

# 暴露端口
EXPOSE 8089 3000

# 启动脚本
CMD ["python", "agent/demo.py"]
```

### docker-compose.yml

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "8089:8089"
      - "3000:3000"
    volumes:
      - ./data:/app/data      # 持久化数据
      - ./resources:/app/resources  # 静态资源
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - GRAPHRAG_API_KEY=${GRAPHRAG_API_KEY}
      - DATABASE_PATH=/app/data/chat_history.db
    restart: unless-stopped

  # 可选：Nginx 反向代理
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - app
    restart: unless-stopped
```

### 启动服务

```bash
# 构建并启动
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

## 🚀 传统部署

### 系统要求

- **操作系统**: Ubuntu 20.04+ / CentOS 7+ / Windows Server
- **Python**: 3.10+
- **Node.js**: 18+
- **内存**: 至少 4GB
- **磁盘**: 至少 20GB（根据数据量调整）

### 部署步骤

#### 1. 克隆项目

```bash
git clone <repository_url>
cd copilotkit_frontend
```

#### 2. 配置环境变量

```bash
cp .env.example .env
nano .env  # 编辑配置
```

#### 3. 安装前端依赖并构建

```bash
npm install
npm run build
```

#### 4. 安装 Python 依赖

```bash
cd agent
pip install -r requirements.txt
```

#### 5. 数据库初始化

```bash
# 首次部署会自动创建数据库在 data/ 目录
# 如果从旧版本迁移，手动移动数据库文件：
mkdir -p data/backups
mv agent/chat_history.db data/chat_history.db
```

#### 6. 启动服务

**开发模式：**
```bash
# 启动 Python Agent
python agent/demo.py

# 另一个终端启动前端
npm run dev
```

**生产模式（使用 PM2）：**
```bash
# 安装 PM2
npm install -g pm2

# 启动后端
pm2 start agent/demo.py --name graphrag-agent --interpreter python

# 使用 Nginx 托管前端静态文件
```

## 🔧 Nginx 配置

创建 `/etc/nginx/sites-available/graphrag`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 前端静态文件
    location / {
        root /path/to/copilotkit_frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # 代理到 Python Agent API
    location /api/ {
        proxy_pass http://127.0.0.1:8089/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # 代理到 CopilotKit Runtime
    location /copilotkit/ {
        proxy_pass http://127.0.0.1:4000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/graphrag /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 📊 监控和日志

### 日志位置

- **应用日志**: `agent/demo.py` 输出
- **数据库**: `data/chat_history.db`
- **备份**: `data/backups/`
- **Nginx 日志**: `/var/log/nginx/`

### PM2 监控

```bash
# 查看状态
pm2 status

# 查看日志
pm2 logs graphrag-agent

# 查看监控
pm2 monit

# 重启服务
pm2 restart graphrag-agent
```

### 数据库监控

```bash
# 查看数据库大小
du -h data/chat_history.db

# 查看表信息
sqlite3 data/chat_history.db ".tables"
sqlite3 data/chat_history.db "SELECT COUNT(*) FROM checkpoints;"
```

## 🔐 安全建议

### 1. 文件权限

```bash
# 数据目录权限
chmod 755 data/
chmod 644 data/chat_history.db

# 环境变量文件
chmod 600 .env
```

### 2. 防火墙配置

```bash
# Ubuntu/Debian
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 8089/tcp  # 如果需要直接访问 API

# CentOS/RHEL
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

### 3. SSL 证书（生产必须）

使用 Let's Encrypt:

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## 📈 性能优化

### SQLite 性能限制

- **并发用户数**: < 100
- **超过限制**: 迁移到 PostgreSQL

### 迁移到 PostgreSQL

修改 `agent/demo.py`:

```python
# 替换 AsyncSqliteSaver
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

# 修改连接
checkpointer = AsyncPostgresSaver.from_conn_string(
    "postgresql://user:password@localhost:5432/graphrag"
)
```

### 缓存优化

在 Nginx 中启用静态资源缓存：

```nginx
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

## 🆘 故障排除

### 数据库损坏

```bash
# 从备份恢复
cp data/backups/chat_history_latest.db data/chat_history.db
pm2 restart graphrag-agent
```

### 磁盘空间不足

```bash
# 清理旧备份
python backup_database.py --cleanup 30

# 清理日志
pm2 flush
```

### 性能问题

```bash
# 检查数据库大小
sqlite3 data/chat_history.db "VACUUM;"

# 查看慢查询
sqlite3 data/chat_history.db "PRAGMA analysis_limit=1000; ANALYZE;"
```

## 📝 维护清单

### 每日
- [ ] 检查服务状态
- [ ] 自动备份执行确认

### 每周
- [ ] 查看错误日志
- [ ] 检查磁盘空间

### 每月
- [ ] 清理旧备份
- [ ] 数据库性能检查
- [ ] 安全更新

## 📞 支持

遇到问题请查看：
- 项目文档: `README.md`
- 数据目录文档: `data/README.md`
- Issue Tracker: [GitHub Issues]
