#!/bin/bash

cd "$(dirname "$0")"

# 检查依赖是否安装
if [ ! -d "node_modules" ]; then
    echo "正在安装依赖..."
    npm install
    cd client && npm install && cd ..
fi

# 启动开发服务器
echo "启动 Claude Manager..."
echo "前端: http://localhost:5173"
echo "后端: http://localhost:3456"
echo ""
npm run dev
