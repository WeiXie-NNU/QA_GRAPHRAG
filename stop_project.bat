@echo off
chcp 65001 >nul
echo ====================================
echo   停止 CopilotKit 项目
echo ====================================
echo.
echo 正在停止所有相关进程...
echo.

REM 停止 Node.js 进程
echo [1/3] 停止 Node.js 进程...
taskkill /F /IM node.exe /T 2>nul
if %errorlevel% == 0 (
    echo    ✓ Node.js 进程已停止
) else (
    echo    ℹ 未找到运行中的 Node.js 进程
)

REM 停止 Python 进程 (demo.py)
echo [2/3] 停止 Python Agent...
for /f "tokens=2" %%a in ('tasklist /FI "IMAGENAME eq python.exe" /FI "WINDOWTITLE eq *demo.py*" /NH 2^>nul') do (
    taskkill /F /PID %%a /T 2>nul
)
echo    ✓ Python Agent 已停止

REM 停止可能占用端口的进程
echo [3/3] 检查端口占用...
for %%p in (8089 8090 4000 5173) do (
    for /f "tokens=5" %%a in ('netstat -aon ^| findstr :%%p ^| findstr LISTENING') do (
        taskkill /F /PID %%a /T 2>nul
        if not errorlevel 1 echo    ✓ 已释放端口 %%p
    )
)

echo.
echo ====================================
echo   所有服务已停止！
echo ====================================
echo.
pause
