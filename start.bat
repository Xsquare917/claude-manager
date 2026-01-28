@echo off
cd /d "%~dp0"

:: 检查依赖是否安装
if not exist "node_modules" (
    echo 正在安装依赖...
    call npm install
    cd client
    call npm install
    cd ..
)

:: 启动开发服务器
echo 启动 Claude Manager...
echo 前端: http://localhost:5173
echo 后端: http://localhost:3456
echo.
call npm run dev
