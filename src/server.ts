import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdirSync, statSync, existsSync } from 'fs';
import { homedir } from 'os';
import { execSync } from 'child_process';
import { SessionManager } from './sessionManager.js';
import { generateSummary } from './summarizer.js';
import type { ServerToClientEvents, ClientToServerEvents } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 计算项目根目录（兼容开发和打包环境）
const isPackaged = __dirname.includes('app.asar');
const rootDir = isPackaged
  ? dirname(dirname(__dirname))  // 打包后: .../app.asar/dist/src -> .../app.asar
  : dirname(dirname(__dirname)); // 开发时: .../dist/src -> ...

// 获取完整的 shell 环境变量（macOS 打包后需要）
function getShellEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;

  // macOS 打包应用可能缺少 PATH，手动补充常见路径
  if (process.platform === 'darwin') {
    const defaultPaths = [
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
      '/opt/homebrew/bin',  // Apple Silicon Homebrew
      `${homedir()}/.nvm/versions/node/*/bin`,  // nvm
      `${homedir()}/.local/bin`,
      '/usr/local/opt/node/bin',
    ];
    const currentPath = env.PATH || '';
    env.PATH = [...new Set([...defaultPaths, ...currentPath.split(':')])].join(':');
  }

  return env;
}

const shellEnv = getShellEnv();

// 全局 sessionManager 引用，用于退出时清理
let globalSessionManager: SessionManager | null = null;

function createApp() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: '*' }
  });

  // Serve static files from client build
  app.use(express.static(join(rootDir, 'client/dist')));
  app.use(express.json());

  // API: 列出目录
  app.get('/api/browse', (req, res) => {
    const path = (req.query.path as string) || homedir();

    if (!existsSync(path)) {
      return res.json({ error: '路径不存在', items: [], currentPath: path });
    }

    try {
      const items = readdirSync(path)
        .filter(name => !name.startsWith('.'))
        .map(name => {
          const fullPath = join(path, name);
          try {
            const stat = statSync(fullPath);
            return {
              name,
              path: fullPath,
              isDirectory: stat.isDirectory(),
              isGitRepo: stat.isDirectory() && existsSync(join(fullPath, '.git'))
            };
          } catch {
            return null;
          }
        })
        .filter((item): item is NonNullable<typeof item> => item !== null && item.isDirectory)
        .sort((a, b) => {
          if (a.isGitRepo !== b.isGitRepo) return a.isGitRepo ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      res.json({ items, currentPath: path, parentPath: dirname(path) });
    } catch (error) {
      res.json({ error: '无法读取目录', items: [], currentPath: path });
    }
  });

  // API: 打开系统目录选择对话框
  app.get('/api/pick-folder', (_req, res) => {
    try {
      const isMac = process.platform === 'darwin';
      const isWin = process.platform === 'win32';

      let result: string;
      if (isMac) {
        const script = 'osascript -e \'POSIX path of (choose folder with prompt "选择项目目录")\'';
        result = execSync(script, { encoding: 'utf-8', timeout: 60000 });
      } else if (isWin) {
        const script = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.ShowDialog() | Out-Null; $f.SelectedPath"`;
        result = execSync(script, { encoding: 'utf-8', timeout: 60000 });
      } else {
        // Linux - 使用 zenity
        result = execSync('zenity --file-selection --directory', { encoding: 'utf-8', timeout: 60000 });
      }

      const path = result.trim().replace(/\/$/, '');
      res.json({ path: path || null });
    } catch (error) {
      res.json({ path: null, cancelled: true });
    }
  });

  // API: 检测 Claude CLI 是否已安装
  app.get('/api/check-cli', (_req, res) => {
    try {
      const version = execSync('claude --version', {
        encoding: 'utf-8',
        timeout: 5000,
        env: shellEnv,
        shell: process.platform === 'darwin' ? '/bin/zsh' : undefined,
      }).trim();
      res.json({ installed: true, version });
    } catch {
      res.json({ installed: false, version: null });
    }
  });

  // API: 检测 Node.js 是否已安装
  app.get('/api/check-node', (_req, res) => {
    try {
      const version = execSync('node --version', {
        encoding: 'utf-8',
        timeout: 5000,
        env: shellEnv,
        shell: process.platform === 'darwin' ? '/bin/zsh' : undefined,
      }).trim();
      res.json({ installed: true, version });
    } catch {
      res.json({ installed: false, version: null });
    }
  });

  // Session manager instance
  const sessionManager = new SessionManager(
    (sessionId, data) => {
      io.emit('session:output', { sessionId, data, timestamp: new Date() });
    },
    (session) => {
      io.emit('session:updated', session);
    }
  );

  // 保存全局引用
  globalSessionManager = sessionManager;

  // 摘要请求队列（避免并发限流）
  const summaryQueue: Array<{ sessionId: string; resolve: () => void; retries: number }> = [];
  let isProcessingSummary = false;
  const MAX_RETRIES = 2;
  const QUEUE_DELAY = 1500; // 增加到 1.5 秒，避免限流

  async function processSummaryQueue() {
    if (isProcessingSummary || summaryQueue.length === 0) return;

    isProcessingSummary = true;
    const item = summaryQueue.shift()!;
    const { sessionId, resolve, retries } = item;

    try {
      const buffer = sessionManager.getSessionBuffer(sessionId);
      if (buffer.length === 0) {
        sessionManager.updateSummary(sessionId, '会话内容为空', '新会话');
        io.emit('summary:updated', { sessionId, summary: '会话内容为空', title: '新会话' });
        resolve();
      } else {
        const { summary, title } = await generateSummary(buffer);
        // 检查是否是限流错误，需要重试
        if (summary === 'API 限流，请稍后重试' && retries < MAX_RETRIES) {
          console.log(`[Summary] Rate limited, will retry (${retries + 1}/${MAX_RETRIES})`);
          summaryQueue.push({ sessionId, resolve, retries: retries + 1 });
          // 不调用 resolve()，让 Promise 继续等待重试结果
        } else {
          sessionManager.updateSummary(sessionId, summary, title);
          io.emit('summary:updated', { sessionId, summary, title });
          resolve();
        }
      }
    } catch (error) {
      console.error('Summary generation error:', error);
      sessionManager.updateSummary(sessionId, '概括生成失败', '新会话');
      io.emit('summary:updated', { sessionId, summary: '概括生成失败', title: '新会话' });
      resolve();
    }

    isProcessingSummary = false;

    // 处理下一个请求（延迟避免限流）
    if (summaryQueue.length > 0) {
      setTimeout(processSummaryQueue, QUEUE_DELAY);
    }
  }

  function queueSummaryRequest(sessionId: string): Promise<void> {
    return new Promise((resolve) => {
      summaryQueue.push({ sessionId, resolve, retries: 0 });
      processSummaryQueue();
    });
  }

  // WebSocket handlers
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Send existing sessions
    const sessions = sessionManager.getAllSessions();
    sessions.forEach(session => {
      socket.emit('session:created', session);
    });

    // Create new session
    socket.on('session:create', (projectPath, launchCommand, callback) => {
      try {
        const session = sessionManager.createSession(projectPath, launchCommand);
        io.emit('session:created', session);
        callback(session);
      } catch (error) {
        console.error('Failed to create session:', error);
        callback(null);
      }
    });

    // Handle terminal input
    socket.on('session:input', (sessionId, data) => {
      sessionManager.writeToSession(sessionId, data);
    });

    // Handle terminal resize
    socket.on('session:resize', (sessionId, cols, rows) => {
      sessionManager.resizeSession(sessionId, cols, rows);
    });

    // Delete session
    socket.on('session:delete', (sessionId) => {
      sessionManager.deleteSession(sessionId);
      io.emit('session:deleted', sessionId);
    });

    // Get session history (for restoring terminal content)
    socket.on('session:getHistory', (sessionId, callback) => {
      const buffer = sessionManager.getSessionBuffer(sessionId);
      callback(buffer.join(''));
    });

    // Request AI summary (使用队列避免并发限流)
    socket.on('session:requestSummary', (sessionId) => {
      queueSummaryRequest(sessionId);
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });

  return httpServer;
}

// 导出启动函数供 Electron 使用
export function startServer(port?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const httpServer = createApp();
    const targetPort = port || Number(process.env.PORT) || 3456;

    const tryListen = (p: number) => {
      httpServer.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && p < targetPort + 10) {
          // 端口被占用，尝试下一个
          tryListen(p + 1);
        } else {
          reject(err);
        }
      });
      httpServer.listen(p, () => {
        console.log(`Claude Manager server running at http://localhost:${p}`);
        resolve(p);
      });
    };

    tryListen(targetPort);
  });
}

// 导出清理函数供 Electron 退出时调用
export function cleanupAllSessions(): void {
  if (globalSessionManager) {
    globalSessionManager.destroyAll();
  }
}

// 直接运行时启动服务器
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  startServer();
}
