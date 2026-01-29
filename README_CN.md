# Claude Manager

<p align="center">
  <img src="logo.png" alt="Claude Manager Logo" width="128" height="128">
</p>

<p align="center">
  <strong>多项目 Claude Code 会话管理器</strong>
</p>

<p align="center">
  <a href="#功能特性">功能特性</a> •
  <a href="#安装">安装</a> •
  <a href="#使用方法">使用方法</a> •
  <a href="#开发">开发</a> •
  <a href="#许可证">许可证</a>
</p>

<p align="center">
  <a href="./README.md">English</a> | <a href="./README_CN.md">中文</a>
</p>

---

## 功能特性

- **多项目管理** - 添加、删除、切换不同的 Git 项目
- **多会话支持** - 每个项目可创建多个 Claude Code 终端会话
- **实时终端** - 基于 xterm.js 的完整终端交互体验
- **AI 状态汇总**
  - **当前任务**（自动刷新）：实时检测 Claude 正在执行的操作
  - **对话概括**（手动刷新）：生成当前会话的内容摘要
- **自动更新检测** - 每 24 小时自动检查新版本
- **指令模板** - 设置默认提示词，创建新会话时自动填入
- **主题切换** - 深色/浅色主题，丝滑切换动画
- **智能滚动** - 终端仅在底部时才自动滚动

## 截图预览

![截图](assets/screenshot.png)

## 安装

### 下载预编译版本

从 [Releases](https://github.com/Xsquare917/claude-manager/releases) 页面下载适合您平台的最新版本：

- **macOS**: `Claude-Manager-x.x.x.dmg`（支持 Intel 和 Apple Silicon）
- **Windows**: `Claude-Manager-Setup-x.x.x.exe`（等待更新）

### 从源码构建

```bash
# 克隆仓库
git clone https://github.com/Xsquare917/claude-manager.git
cd claude-manager

# 安装依赖
npm install
cd client && npm install && cd ..

# 构建打包
npm run dist:mac    # macOS 版本
npm run dist:win    # Windows 版本
npm run dist:all    # 所有平台
```

## 使用方法

1. 启动 Claude Manager
2. 点击 **"+ 添加项目"** 添加您的 Git 项目目录
3. 点击项目创建新的 Claude Code 会话
4. 在集成终端中与 Claude Code 交互
5. 查看实时任务状态，生成对话摘要

### 设置选项

- **主题**：切换深色/浅色模式
- **快捷键**：自定义键盘快捷键
- **指令模板**：设置新会话的默认提示词
- **版本**：查看当前版本，检查更新

## 开发

```bash
# 安装依赖
npm install
cd client && npm install && cd ..

# 开发模式运行
npm run dev

# 访问地址
# 前端: http://localhost:5173
# 后端: http://localhost:3456
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Vite |
| 终端 | xterm.js |
| 后端 | Express + Socket.IO |
| 进程管理 | node-pty |
| AI 接口 | Anthropic SDK |
| 桌面应用 | Electron |

## 许可证

本项目采用双授权模式：

- **非商业用途**：个人、教育和非营利组织免费使用
- **商业用途**：需要获取商业许可

详见 [LICENSE](LICENSE)。

---

<p align="center">为 Claude Code 用户用心打造 ❤️</p>
