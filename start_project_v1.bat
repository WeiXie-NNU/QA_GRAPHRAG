@echo off
chcp 65001 >nul
echo ====================================
echo   启动 QA_GRAPHRAG 项目
echo ====================================
echo.
echo 正在启动三个服务...
echo.

REM 获取当前目录
set ROOT_DIR=%~dp0
set AGENT_PORT=8091
set AGENT_BASE_URL=http://127.0.0.1:%AGENT_PORT%

REM 1. 启动 Python Agent 后端服务器
echo [1/3] 启动 Python Agent 后端 (conda env: graphrag)...
start "Python Agent Backend" cmd /k "echo === Python Agent Backend === && echo. && echo 激活 .venv 环境 && call .venv\Scripts\activate.bat && set AGENT_PORT=%AGENT_PORT% && python agent\demo.py"
timeout /t 2 /nobreak >nul

REM 2. 启动 Node.js Runtime 服务器
echo [2/3] 启动 Node.js Runtime (conda env: graphrag)...
start "Node.js Runtime" cmd /k "cd /d %ROOT_DIR%runtime && echo === Node.js Runtime === && echo. && echo 激活 conda 环境: graphrag && conda activate graphrag && set AGENT_BASE_URL=%AGENT_BASE_URL% && npm run dev"
timeout /t 2 /nobreak >nul

REM 3. 启动前端开发服务器
echo [3/3] 启动前端开发服务器 (conda env: graphrag)...
start "Frontend Dev Server" cmd /k "echo === Frontend Dev Server === && echo. && echo 激活 conda 环境: graphrag && conda activate graphrag && npm run dev"

echo.
echo ====================================
echo   所有服务已启动！
echo ====================================
echo.
echo 三个终端窗口已打开：
echo   [1] Python Agent Backend  (端口 %AGENT_PORT%)
echo   [2] Node.js Runtime       (端口 4000)
echo   [3] Frontend Dev Server   (端口 5173)
echo.
echo 请等待所有服务启动完成后访问前端地址
echo.
echo 按任意键关闭此窗口...
pause >nul
