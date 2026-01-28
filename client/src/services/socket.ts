import { io, Socket } from 'socket.io-client';

export interface Session {
  id: string;
  projectPath: string;
  projectName: string;
  status: 'idle' | 'busy' | 'waiting';
  createdAt: Date;
  lastActivity: Date;
  currentTask: string;
  summary: string;
  title: string;
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

  constructor() {
    // 开发模式使用代理，生产模式使用相对路径
    const url = import.meta.env.DEV ? '' : window.location.origin;
    this.socket = io(url);
    this.setupListeners();
  }

  private setupListeners() {
    this.socket.on('session:created', (session: Session) => {
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

    this.socket.on('summary:updated', (data: { sessionId: string; summary: string; title: string }) => {
      this.emit('summary:updated', data);
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
  }

  off(event: string, callback: Function) {
    this.listeners.get(event)?.delete(callback);
  }

  createSession(projectPath: string): Promise<Session> {
    return new Promise((resolve) => {
      this.socket.emit('session:create', projectPath, resolve);
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

  requestSummary(sessionId: string) {
    this.socket.emit('session:requestSummary', sessionId);
  }

  getSessionHistory(sessionId: string): Promise<string> {
    return new Promise((resolve) => {
      this.socket.emit('session:getHistory', sessionId, resolve);
    });
  }
}

export const socketService = new SocketService();
