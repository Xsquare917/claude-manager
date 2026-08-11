import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdirSync, statSync, existsSync } from 'fs';
import { homedir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { SessionManager } from './sessionManager.js';
import type { ServerToClientEvents, ClientToServerEvents } from './types.js';

const execAsync = promisify(exec);

// 仅接受本机来源：服务只绑定 127.0.0.1，这两个正则进一步挡住
// 恶意网页对 localhost 的跨源请求（WebSocket 握手无 CORS 预检）及 DNS rebinding
const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1)(:\d+)?$/;
const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

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
    cors: {
      origin: (origin, callback) => {
        if (!origin || LOCAL_ORIGIN_RE.test(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Origin not allowed'));
        }
      }
    },
    // cors 只覆盖 polling 握手，websocket 直连升级走这里校验
    allowRequest: (req, callback) => {
      const host = req.headers.host || '';
      const origin = req.headers.origin;
      const allowed = LOCAL_HOST_RE.test(host) && (!origin || LOCAL_ORIGIN_RE.test(origin));
      callback(null, allowed);
    }
  });

  // Host/Origin 校验（Origin 缺失的是同源或非浏览器请求，如 hooks 的 curl，放行）
  app.use((req, res, next) => {
    const host = req.headers.host || '';
    const origin = req.headers.origin;
    if (!LOCAL_HOST_RE.test(host) || (origin && !LOCAL_ORIGIN_RE.test(origin))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
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

  // API: 打开系统目录选择对话框（异步执行，避免对话框打开期间阻塞事件循环）
  let pickFolderInFlight = false;
  app.get('/api/pick-folder', async (_req, res) => {
    if (pickFolderInFlight) {
      return res.json({ path: null, busy: true });
    }
    pickFolderInFlight = true;

    try {
      const isMac = process.platform === 'darwin';
      const isWin = process.platform === 'win32';

      let script: string;
      if (isMac) {
        script = 'osascript -e \'POSIX path of (choose folder with prompt "选择项目目录")\'';
      } else if (isWin) {
        script = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.ShowDialog() | Out-Null; $f.SelectedPath"`;
      } else {
        // Linux - 使用 zenity
        script = 'zenity --file-selection --directory';
      }

      const { stdout } = await execAsync(script, { encoding: 'utf-8', timeout: 60000 });
      const path = stdout.trim().replace(/\/$/, '');
      res.json({ path: path || null });
    } catch (error) {
      res.json({ path: null, cancelled: true });
    } finally {
      pickFolderInFlight = false;
    }
  });

  // 异步检测命令是否可用
  const checkCommand = async (command: string): Promise<{ installed: boolean; version: string | null }> => {
    try {
      const { stdout } = await execAsync(`${command} --version`, {
        encoding: 'utf-8',
        timeout: 5000,
        env: shellEnv,
        shell: process.platform === 'darwin' ? '/bin/zsh' : undefined,
      });
      return { installed: true, version: stdout.trim() };
    } catch {
      return { installed: false, version: null };
    }
  };

  // API: 检测 Claude CLI 是否已安装
  app.get('/api/check-cli', async (_req, res) => {
    res.json(await checkCommand('claude'));
  });

  // API: 检测 Node.js 是否已安装
  app.get('/api/check-node', async (_req, res) => {
    res.json(await checkCommand('node'));
  });

  // API: 检测多个 CLI 工具是否已安装（并行检测）
  app.get('/api/check-clis', async (_req, res) => {
    const clis = ['claude', 'codex', 'gemini'];
    const checks = await Promise.all(clis.map(cli => checkCommand(cli)));

    const results: Record<string, { installed: boolean; version?: string }> = {};
    clis.forEach((cli, i) => {
      results[cli] = checks[i].installed
        ? { installed: true, version: checks[i].version! }
        : { installed: false };
    });

    res.json(results);
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

  // Claude Code hooks 回调（由 --settings 注入的 hook 命令上报状态事件）
  app.post('/api/claude-hook', (req, res) => {
    const event = String(req.query.event || '');
    const sessionId = String(req.query.session || '');
    sessionManager.handleHookEvent(sessionId, event, req.body ?? {});
    res.json({ ok: true });
  });

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

    // Wake dormant session
    socket.on('session:wake', (sessionId) => {
      sessionManager.wakeSession(sessionId);
    });

    // Get session history (for restoring terminal content)
    socket.on('session:getHistory', (sessionId, callback) => {
      const buffer = sessionManager.getSessionBuffer(sessionId);
      callback(buffer.join(''));
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });

  return { httpServer, sessionManager };
}

// 导出启动函数供 Electron 使用
export function startServer(port?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const { httpServer, sessionManager } = createApp();
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
      httpServer.listen(p, '127.0.0.1', () => {
        console.log(`Claude Manager server running at http://localhost:${p}`);
        // hook 回调依赖实际端口，必须在恢复/创建会话前设置
        sessionManager.setServerPort(p);
        // 恢复上次退出时的会话（对话内容通过 claude --resume 接续）
        sessionManager.restorePersistedSessions();
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

  // 独立运行时退出前清理 PTY 进程（Electron 模式由 before-quit 处理）
  const shutdown = () => {
    cleanupAllSessions();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
