import { app, BrowserWindow, shell } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { startServer, cleanupAllSessions } from '../src/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let serverPort: number = 3456;

function getSplashPath() {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'app.asar', 'splash.html');
  }
  // 开发模式: dist/electron -> 项目根目录
  return join(__dirname, '../../splash.html');
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 400,
    height: 350,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    backgroundColor: '#00000000',
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  splashWindow.loadFile(getSplashPath());
  splashWindow.center();
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Claude Manager',
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://localhost:${serverPort}`);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.once('ready-to-show', () => {
    if (splashWindow) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // 先显示启动画面
  createSplashWindow();

  // 后台启动服务器
  try {
    serverPort = await startServer();
    console.log(`Server started on port ${serverPort}`);
  } catch (err) {
    console.error('Failed to start server:', err);
    if (splashWindow) splashWindow.close();
    app.quit();
    return;
  }

  // 创建主窗口
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 应用退出前清理所有会话
app.on('before-quit', () => {
  console.log('App quitting, cleaning up all sessions...');
  cleanupAllSessions();
});
