import { io, Socket } from 'socket.io-client';

export interface Session {
  id: string;
  projectPath: string;
  projectName: string;
  status: 'idle' | 'busy' | 'waiting' | 'dormant';
  createdAt: Date;
  lastActivity: Date;
  currentTask: string;
  title: string;
  lastMessage: string | null;    // transcript 最后一条消息预览
  contextTokens: number | null;  // 当前上下文 token 量
  unread: boolean;  // 是否有未读通知（waiting 状态且未点击）
}

export interface SessionOutput {
  sessionId: string;
  data: string;
  timestamp: Date;
}

class SocketService {
  private socket: Socket;
  private listeners: Map<string, Set<Function>> = new Map();
  // 缓存监听注册前早到的会话事件（socket 可能先于 React 挂载完成连接）
  private earlySessions: Session[] = [];

  constructor() {
    // 开发模式使用代理，生产模式使用相对路径
    const url = import.meta.env.DEV ? '' : window.location.origin;
    this.socket = io(url);
    this.setupListeners();
  }

  private setupListeners() {
    this.socket.on('session:created', (session: Session) => {
      if (!this.listeners.get('session:created')?.size) {
        this.earlySessions.push(session);
        return;
      }
      this.emit('session:created', session);
    });

    this.socket.on('session:updated', (session: Session) => {
      this.emit('session:updated', session);
    });

    this.socket.on('session:deleted', (sessionId: string) => {
      this.emit('session:deleted', sessionId);
    });

    this.socket.on('session:output', (output: SessionOutput) => {
      this.emit('session:output', output);
    });
  }

  private emit(event: string, data: unknown) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(cb => cb(data));
    }
  }

  on(event: string, callback: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    // 补发监听注册前缓存的会话
    if (event === 'session:created' && this.earlySessions.length > 0) {
      const buffered = this.earlySessions;
      this.earlySessions = [];
      buffered.forEach(session => callback(session));
    }
  }

  off(event: string, callback: Function) {
    this.listeners.get(event)?.delete(callback);
  }

  createSession(projectPath: string, launchCommand: string = 'claude'): Promise<Session> {
    return new Promise((resolve) => {
      this.socket.emit('session:create', projectPath, launchCommand, resolve);
    });
  }

  sendInput(sessionId: string, data: string) {
    this.socket.emit('session:input', sessionId, data);
  }

  resizeTerminal(sessionId: string, cols: number, rows: number) {
    this.socket.emit('session:resize', sessionId, cols, rows);
  }

  deleteSession(sessionId: string) {
    this.socket.emit('session:delete', sessionId);
  }

  wakeSession(sessionId: string) {
    this.socket.emit('session:wake', sessionId);
  }

  getSessionHistory(sessionId: string): Promise<string> {
    return new Promise((resolve) => {
      this.socket.emit('session:getHistory', sessionId, resolve);
    });
  }
}

export const socketService = new SocketService();
