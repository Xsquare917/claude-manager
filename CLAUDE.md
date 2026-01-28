# Claude Manager - 多项目 Claude Code 会话管理器

## 项目概述

一个 Web GUI 工具，用于统一管理多个项目中的多个 Claude Code 终端会话，并提供 AI 驱动的会话状态汇总功能。

## 核心功能

1. **多项目管理**: 添加、删除、切换不同的 Git 项目
2. **多会话管理**: 每个项目可创建多个 Claude Code 终端会话
3. **实时终端**: 基于 xterm.js 的完整终端交互
4. **AI 状态汇总**:
   - **当前任务** (动态刷新): 实时检测 Claude 正在做什么
   - **对话概括** (手动刷新): 点击按钮生成当前会话的内容摘要

## 代码结构

```
claude-manager/
├── package.json              # 根项目配置
├── tsconfig.json             # TypeScript 配置
├── src/                      # 后端源码 (Node.js)
│   ├── server.ts             # Express + Socket.IO 服务器入口
│   ├── sessionManager.ts     # 会话管理器 (PTY 进程管理)
│   ├── summarizer.ts         # AI 摘要生成器 (调用 Claude API)
│   └── types.ts              # 共享类型定义
├── client/                   # 前端源码 (React + Vite)
│   ├── package.json
│   ├── index.html
│   ├── src/
│   │   ├── main.tsx          # React 入口
│   │   ├── App.tsx           # 主应用组件
│   │   ├── App.css           # 全局样式
│   │   ├── services/
│   │   │   └── socket.ts     # WebSocket 客户端服务
│   │   └── components/
│   │       ├── Sidebar.tsx       # 左侧边栏 (项目/会话列表)
│   │       ├── Terminal.tsx      # 终端组件 (xterm.js)
│   │       ├── StatusPanel.tsx   # 状态面板 (AI 汇总显示)
│   │       └── AddProjectModal.tsx # 添加项目弹窗
│   └── dist/                 # 构建输出
└── dist/                     # 后端构建输出
```

## 功能架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Claude Manager                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐  ┌─────────────────────────────────────────────┐  │
│  │   Sidebar    │  │              Main Area                       │  │
│  │              │  │  ┌───────────────────────────────────────┐  │  │
│  │ ┌──────────┐ │  │  │           Terminal Tabs               │  │  │
│  │ │ Projects │ │  │  │  [Session1] [Session2] [Session3] [+] │  │  │
│  │ │ ├─ Proj1 │ │  │  └───────────────────────────────────────┘  │  │
│  │ │ │  ├─ S1 │ │  │  ┌───────────────────────────────────────┐  │  │
│  │ │ │  └─ S2 │ │  │  │                                       │  │  │
│  │ │ └─ Proj2 │ │  │  │         Terminal (xterm.js)           │  │  │
│  │ │    └─ S1 │ │  │  │                                       │  │  │
│  │ └──────────┘ │  │  │                                       │  │  │
│  │              │  │  └───────────────────────────────────────┘  │  │
│  │ [+ Project]  │  │  ┌───────────────────────────────────────┐  │  │
│  │              │  │  │         Status Panel                  │  │  │
│  └──────────────┘  │  │  当前任务: 正在编辑文件 (动态)         │  │  │
│                    │  │  对话概括: 用户正在开发... [刷新]      │  │  │
│                    │  └───────────────────────────────────────┘  │  │
│                    └─────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## 数据流架构

```
┌─────────────┐     WebSocket      ┌─────────────┐      PTY       ┌─────────────┐
│   Browser   │ ◄───────────────► │   Server    │ ◄────────────► │ Claude CLI  │
│  (React)    │                    │  (Node.js)  │                │  Processes  │
└─────────────┘                    └─────────────┘                └─────────────┘
      │                                  │
      │                                  │ Claude API
      │                                  ▼
      │                            ┌─────────────┐
      │                            │  Anthropic  │
      │                            │     API     │
      └────────────────────────────┴─────────────┘
                                   (生成摘要)
```

## 核心类型定义

```typescript
interface Session {
  id: string;
  projectPath: string;
  projectName: string;
  status: 'idle' | 'busy' | 'waiting';
  createdAt: Date;
  lastActivity: Date;
  outputBuffer: string[];    // 终端输出缓冲
  currentTask: string;       // 动态: 当前在做什么
  summary: string;           // 手动: 对话内容概括
}

interface Project {
  id: string;
  name: string;
  path: string;
  sessions: string[];        // 关联的 session IDs
}
```

## WebSocket 事件

### 服务端 → 客户端

| 事件 | 数据 | 说明 |
|------|------|------|
| `session:created` | Session | 新会话创建 |
| `session:updated` | Session | 会话状态更新 |
| `session:deleted` | sessionId | 会话删除 |
| `session:output` | {sessionId, data} | 终端输出 |
| `summary:updated` | {sessionId, summary} | AI 摘要更新 |

### 客户端 → 服务端

| 事件 | 数据 | 说明 |
|------|------|------|
| `session:create` | projectPath | 创建新会话 |
| `session:input` | sessionId, data | 发送终端输入 |
| `session:resize` | sessionId, cols, rows | 调整终端大小 |
| `session:delete` | sessionId | 删除会话 |
| `session:requestSummary` | sessionId | 请求 AI 生成摘要 |

## 状态检测逻辑

```typescript
// 根据终端输出检测当前状态
function detectStatus(output: string): Status {
  if (output.includes('?') || output.includes('[Y/n]')) return 'waiting';
  if (output.includes('⠋') || output.includes('Working')) return 'busy';
  return 'idle';
}

// 根据终端输出检测当前任务
function detectCurrentTask(output: string): string {
  if (output.includes('Reading')) return '正在读取文件';
  if (output.includes('Writing')) return '正在写入文件';
  if (output.includes('Editing')) return '正在编辑文件';
  if (output.includes('Searching')) return '正在搜索';
  if (output.includes('Running')) return '正在执行命令';
  return '空闲';
}
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | React 18 + TypeScript |
| 构建工具 | Vite |
| 终端模拟 | xterm.js |
| 后端框架 | Express |
| 实时通信 | Socket.IO |
| 终端进程 | node-pty |
| AI 接口 | Anthropic SDK |

## 待实现文件清单

### 后端 (已完成)
- [x] src/types.ts
- [x] src/sessionManager.ts
- [x] src/summarizer.ts
- [x] src/server.ts

### 前端 (已完成)
- [x] client/src/services/socket.ts
- [x] client/src/App.tsx
- [x] client/src/App.css
- [x] client/src/components/Sidebar.tsx
- [x] client/src/components/Terminal.tsx
- [x] client/src/components/StatusPanel.tsx
- [x] client/src/components/AddProjectModal.tsx

## 启动命令

```bash
# 安装依赖
npm install
cd client && npm install

# 开发模式
npm run dev

# 生产构建
npm run build
npm start
```

## 访问地址

开发模式: http://localhost:5173 (前端) + http://localhost:3456 (后端)
生产模式: http://localhost:3456
