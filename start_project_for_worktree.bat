@echo off
chcp 65001 >nul
echo ====================================
echo   启动 QA_GRAPHRAG 项目 worktree
echo ====================================
echo.
echo.

REM 获取当前目录
set ROOT_DIR=%~dp0
set AGENT_PORT=8091
set AGENT_BASE_URL=http://127.0.0.1:%AGENT_PORT%

REM 3. 启动前端开发服务器
echo [3/3] 启动前端开发服务器 (conda env: graphrag)...
start "Frontend Dev Server" cmd /k "echo === Frontend Dev Server === && echo. && echo 激活 conda 环境: graphrag && conda activate graphrag && npm run dev"

echo.
echo ====================================
echo   所有服务已启动！
echo ====================================
echo.
echo 前端窗口已打开：
echo   [1] Frontend Dev Server   (端口 5173)
echo.
echo 请等待所有服务启动完成后访问前端地址
echo.
echo 按任意键关闭此窗口...
pause >nul
