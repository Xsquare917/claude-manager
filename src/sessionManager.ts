import * as pty from 'node-pty';
import { v4 as uuidv4 } from 'uuid';
import { Session } from './types.js';

const MAX_BUFFER_CHUNKS = 5000;  // 增加缓冲区大小，存储更多历史
const DEBOUNCE_TIME = 1500;

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private ptys: Map<string, pty.IPty> = new Map();
  private lastBusyTime: Map<string, number> = new Map();
  private statusTimers: Map<string, NodeJS.Timeout> = new Map(); // 状态检测定时器
  private onOutput: (sessionId: string, data: string) => void;
  private onStatusChange: (session: Session) => void;

  constructor(
    onOutput: (sessionId: string, data: string) => void,
    onStatusChange: (session: Session) => void
  ) {
    this.onOutput = onOutput;
    this.onStatusChange = onStatusChange;
  }

  createSession(projectPath: string): Session {
    const id = uuidv4();
    const projectName = projectPath.split('/').pop() || projectPath;

    const session: Session = {
      id,
      projectPath,
      projectName,
      status: 'idle',
      createdAt: new Date(),
      lastActivity: new Date(),
      outputBuffer: [],
      currentTask: '等待启动',
      summary: '新会话，尚未开始对话',
      title: '新会话'
    };

    // 使用 node-pty 创建终端
    // 使用较小的默认尺寸，前端会在初始化后发送实际尺寸
    const ptyProcess = pty.spawn('/bin/zsh', ['-l', '-c', 'claude'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: projectPath,
      env: process.env as { [key: string]: string }
    });

    ptyProcess.onData((data: string) => {
      this.handleOutput(id, data);
    });

    ptyProcess.onExit(() => {
      this.clearStatusTimer(id);
      this.sessions.delete(id);
      this.ptys.delete(id);
      this.lastBusyTime.delete(id);
      this.lastTask.delete(id);
    });

    this.sessions.set(id, session);
    this.ptys.set(id, ptyProcess);

    return session;
  }

  private clearStatusTimer(sessionId: string): void {
    const timer = this.statusTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.statusTimers.delete(sessionId);
    }
  }

  // 延迟重新检测状态
  private scheduleStatusRecheck(sessionId: string): void {
    this.clearStatusTimer(sessionId);

    const timer = setTimeout(() => {
      this.statusTimers.delete(sessionId);
      const session = this.sessions.get(sessionId);
      if (!session) return;

      const oldStatus = session.status;
      const oldTask = session.currentTask;

      // 重新检测状态
      session.status = this.detectStatus('', session.outputBuffer, sessionId);
      session.currentTask = this.detectCurrentTask('', session.outputBuffer, sessionId);

      if (oldStatus !== session.status || oldTask !== session.currentTask) {
        console.log(`[${sessionId.slice(0,8)}] Recheck: ${oldStatus} -> ${session.status}, Task: ${session.currentTask}`);
        this.onStatusChange(session);
      }
    }, DEBOUNCE_TIME + 100);

    this.statusTimers.set(sessionId, timer);
  }

  private handleOutput(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.outputBuffer.push(data);
    if (session.outputBuffer.length > MAX_BUFFER_CHUNKS) {
      session.outputBuffer = session.outputBuffer.slice(-MAX_BUFFER_CHUNKS);
    }

    session.lastActivity = new Date();
    const oldStatus = session.status;
    const oldTask = session.currentTask;
    session.status = this.detectStatus(data, session.outputBuffer, sessionId);
    session.currentTask = this.detectCurrentTask(data, session.outputBuffer, sessionId);

    // 如果状态是 busy，安排延迟重新检测
    if (session.status === 'busy') {
      this.scheduleStatusRecheck(sessionId);
    }

    if (oldStatus !== session.status || oldTask !== session.currentTask) {
      console.log(`[${sessionId.slice(0,8)}] Status: ${oldStatus} -> ${session.status}, Task: ${session.currentTask}`);
      this.onStatusChange(session);
    }

    this.onOutput(sessionId, data);
  }

  private detectStatus(data: string, buffer: string[], sessionId: string): 'idle' | 'busy' | 'waiting' {
    const recentOutput = buffer.slice(-10).join('');
    const now = Date.now();

    // Claude 使用的 spinner 字符: ✻ ✽ ✶ ✳ ✢ · ⠂ ⠐
    const spinnerChars = ['✻', '✽', '✶', '✳', '✢', '·', '⠂', '⠐'];
    const hasSpinner = spinnerChars.some(char => data.includes(char));

    if (hasSpinner) {
      this.lastBusyTime.set(sessionId, now);
      return 'busy';
    }

    // 防抖：如果最近 1.5 秒内检测到过忙碌状态，继续保持忙碌
    const lastBusy = this.lastBusyTime.get(sessionId) || 0;
    if (now - lastBusy < DEBOUNCE_TIME) {
      return 'busy';
    }

    // 只有防抖时间过了之后，才检测等待输入状态
    // 只检测明确的交互提示符
    const isWaiting = recentOutput.includes('[Y/n]') ||
                      recentOutput.includes('[y/N]') ||
                      recentOutput.includes('(y/n)') ||
                      recentOutput.includes('(Y/n)');

    if (isWaiting) {
      return 'waiting';
    }

    return 'idle';
  }

  private lastTask: Map<string, string> = new Map(); // 记录上次任务

  private detectCurrentTask(data: string, buffer: string[], sessionId: string): string {
    const recentOutput = buffer.slice(-20).join('');
    const now = Date.now();

    // Claude 使用的 spinner 字符
    const spinnerChars = ['✻', '✽', '✶', '✳', '✢', '·', '⠂', '⠐'];
    const hasSpinner = spinnerChars.some(char => data.includes(char));

    let task = '';
    if (hasSpinner) {
      if (recentOutput.includes('Read')) task = '正在读取文件';
      else if (recentOutput.includes('Write') || recentOutput.includes('Edit')) task = '正在编辑文件';
      else if (recentOutput.includes('Search') || recentOutput.includes('Grep')) task = '正在搜索';
      else if (recentOutput.includes('Bash') || recentOutput.includes('Run')) task = '正在执行命令';
      else if (recentOutput.includes('Think')) task = '正在思考';
      else task = '正在处理';

      this.lastTask.set(sessionId, task);
      return task;
    }

    // 防抖：如果最近 DEBOUNCE_TIME 内处于忙碌状态，保持上次的任务
    const lastBusy = this.lastBusyTime.get(sessionId) || 0;
    if (now - lastBusy < DEBOUNCE_TIME) {
      return this.lastTask.get(sessionId) || '正在处理';
    }

    // 检测等待输入
    const isWaiting = recentOutput.includes('[Y/n]') ||
                      recentOutput.includes('[y/N]');

    if (isWaiting) {
      return '等待输入';
    }

    return '空闲';
  }

  writeToSession(sessionId: string, data: string): void {
    const ptyProcess = this.ptys.get(sessionId);
    if (ptyProcess) {
      ptyProcess.write(data);
    }
  }

  resizeSession(sessionId: string, cols: number, rows: number): void {
    const ptyProcess = this.ptys.get(sessionId);
    if (ptyProcess) {
      ptyProcess.resize(cols, rows);
    }
  }

  deleteSession(sessionId: string): void {
    this.clearStatusTimer(sessionId);
    const ptyProcess = this.ptys.get(sessionId);
    if (ptyProcess) {
      ptyProcess.kill();
    }
    this.sessions.delete(sessionId);
    this.ptys.delete(sessionId);
    this.lastBusyTime.delete(sessionId);
    this.lastTask.delete(sessionId);
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  getAllSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  getSessionBuffer(sessionId: string): string[] {
    return this.sessions.get(sessionId)?.outputBuffer || [];
  }

  // 清理所有会话（应用退出时调用）
  destroyAll(): void {
    console.log(`Destroying all sessions (${this.ptys.size} total)`);
    for (const [sessionId, ptyProcess] of this.ptys) {
      this.clearStatusTimer(sessionId);
      ptyProcess.kill();
    }
    this.sessions.clear();
    this.ptys.clear();
    this.lastBusyTime.clear();
    this.lastTask.clear();
    this.statusTimers.clear();
  }

  updateSummary(sessionId: string, summary: string, title: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.summary = summary;
      session.title = title;
    }
  }
}
