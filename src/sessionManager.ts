import * as pty from 'node-pty';
import { v4 as uuidv4 } from 'uuid';
import { readdirSync, existsSync } from 'fs';
import { Session } from './types.js';
import {
  loadStore,
  saveStore,
  claudeTranscriptDir,
  claudeTranscriptPath,
  writeHooksSettingsFile,
  readFirstUserMessage,
  readTranscriptTail,
  type PersistedSession,
} from './store.js';

const MAX_BUFFER_CHUNKS = 2500;  // 缓冲区大小，平衡内存占用和历史记录
const TRANSCRIPT_POLL_INTERVAL = 3000;
const TITLE_MAX_LENGTH = 12;

// 标题来源优先级：transcript（结构化，最优）> typed（输入行降级）> default
type TitleSource = 'default' | 'typed' | 'transcript';

// 清洗用户敲入的一行：去掉 ESC 序列（方向键、bracketed paste 标记等）、应用退格、去控制字符
function cleanTypedLine(line: string): string {
  let text = line
    .replace(/\x1b\[[0-9;?]*[a-zA-Z~]/g, '')
    .replace(/\x1b./g, '');
  while (/[^\x7f]\x7f/.test(text)) {
    text = text.replace(/[^\x7f]\x7f/g, '');
  }
  return text.replace(/\x7f/g, '').replace(/[\x00-\x1f]/g, '').trim();
}

function taskLabelForTool(toolName: string): string {
  if (toolName === 'Read') return '正在读取文件';
  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'NotebookEdit') return '正在编辑文件';
  if (toolName === 'Grep' || toolName === 'Glob') return '正在搜索';
  if (toolName === 'Bash' || toolName === 'BashOutput') return '正在执行命令';
  if (toolName === 'Task') return '正在调度子任务';
  if (toolName === 'WebSearch' || toolName === 'WebFetch') return '正在联网查询';
  return toolName ? `正在使用 ${toolName}` : '正在处理';
}

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private ptys: Map<string, pty.IPty> = new Map();
  private launchCommands: Map<string, string> = new Map();       // 会话的原始启动命令
  private claudeSessionIds: Map<string, string> = new Map();     // 会话对应的 Claude CLI sessionId
  private transcriptWatchers: Map<string, NodeJS.Timeout> = new Map(); // transcript 轮询定时器
  private titleWatchers: Map<string, NodeJS.Timeout> = new Map();      // 标题读取轮询定时器
  private claimedTranscripts: Set<string> = new Set();           // 已被认领的 transcript，避免多会话抢占
  private inputLineBuffers: Map<string, string> = new Map();     // 标题降级方案的输入行缓冲
  private titleSources: Map<string, TitleSource> = new Map();
  private hooksSettingsFile: string;
  private serverPort = 0;
  private shuttingDown = false;
  private onOutput: (sessionId: string, data: string) => void;
  private onStatusChange: (session: Session) => void;

  constructor(
    onOutput: (sessionId: string, data: string) => void,
    onStatusChange: (session: Session) => void
  ) {
    this.onOutput = onOutput;
    this.onStatusChange = onStatusChange;
    this.hooksSettingsFile = writeHooksSettingsFile();
  }

  // 服务端实际监听端口确定后调用，hook 回调依赖它；必须在创建/恢复会话前设置
  setServerPort(port: number): void {
    this.serverPort = port;
  }

  // 启动时恢复上次持久化的会话为休眠态（不拉起进程，点击时唤醒）
  restorePersistedSessions(): void {
    const { sessions } = loadStore();
    for (const persisted of sessions) {
      if (!existsSync(persisted.projectPath)) {
        console.log(`Skip restoring session ${persisted.id.slice(0, 8)}: project path missing`);
        continue;
      }

      const session: Session = {
        id: persisted.id,
        projectPath: persisted.projectPath,
        projectName: persisted.projectPath.split('/').pop() || persisted.projectPath,
        status: 'dormant',
        createdAt: new Date(persisted.createdAt),
        lastActivity: new Date(persisted.createdAt),
        outputBuffer: [],
        currentTask: '已休眠',
        title: persisted.title,
        lastMessage: null,
        contextTokens: null,
      };

      this.sessions.set(persisted.id, session);
      this.launchCommands.set(persisted.id, persisted.launchCommand);
      this.titleSources.set(persisted.id, persisted.title !== '新会话' ? 'transcript' : 'default');
      if (persisted.claudeSessionId) {
        this.claudeSessionIds.set(persisted.id, persisted.claudeSessionId);
        this.claimedTranscripts.add(persisted.claudeSessionId);
        this.refreshTranscriptInfo(persisted.id);
      }
      console.log(`Restored session ${persisted.id.slice(0, 8)} (${persisted.title}) as dormant`);
    }
    // 恢复完成后重写存储，清掉项目已删除等无法恢复的条目
    this.persist();
  }

  // 从 transcript 尾部刷新最后消息预览和上下文 token 量
  private refreshTranscriptInfo(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    const claudeSessionId = this.claudeSessionIds.get(sessionId);
    if (!session || !claudeSessionId) return;

    const info = readTranscriptTail(claudeTranscriptPath(session.projectPath, claudeSessionId));
    if (info.lastMessage !== null) session.lastMessage = info.lastMessage;
    if (info.contextTokens !== null) session.contextTokens = info.contextTokens;
  }

  private persist(): void {
    const sessions: PersistedSession[] = Array.from(this.sessions.values()).map(s => ({
      id: s.id,
      projectPath: s.projectPath,
      title: s.title,
      launchCommand: this.launchCommands.get(s.id) || 'claude',
      claudeSessionId: this.claudeSessionIds.get(s.id) || null,
      createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : String(s.createdAt),
    }));
    saveStore({ sessions });
  }

  createSession(projectPath: string, launchCommand: string = 'claude'): Session {
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
      currentTask: '空闲',
      title: '新会话',
      lastMessage: null,
      contextTokens: null,
    };

    this.sessions.set(id, session);
    this.launchCommands.set(id, launchCommand);
    this.titleSources.set(id, 'default');

    this.spawnPty(id);
    this.persist();

    return session;
  }

  // 唤醒休眠会话：重新拉起进程（claude 会话通过 --resume 接续原对话）
  wakeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || this.ptys.has(sessionId)) return;

    session.status = 'idle';
    session.currentTask = '空闲';
    session.lastActivity = new Date();
    this.spawnPty(sessionId);
    this.onStatusChange(session);
  }

  // 为会话拉起 PTY 进程（新建和唤醒共用）
  private spawnPty(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const launchCommand = this.launchCommands.get(sessionId) || 'claude';
    const isClaude = launchCommand.trim().startsWith('claude');

    // claude 会话注入 hooks 配置，状态由 hook 事件上报
    let spawnCommand = isClaude
      ? `${launchCommand} --settings "${this.hooksSettingsFile}"`
      : launchCommand;

    // 已有 Claude CLI 对话记录时用 --resume 接上
    const claudeSessionId = this.claudeSessionIds.get(sessionId);
    if (isClaude && claudeSessionId
        && existsSync(claudeTranscriptPath(session.projectPath, claudeSessionId))) {
      spawnCommand = `${spawnCommand} --resume ${claudeSessionId}`;
    }

    // 使用较小的默认尺寸，前端会在初始化后发送实际尺寸
    const ptyProcess = pty.spawn('/bin/zsh', ['-l', '-c', spawnCommand], {
      name: 'xterm',  // TERM=xterm，声明 16 色能力，鼓励 CLI 输出可被主题调色板映射的索引色
      cols: 80,
      rows: 24,
      cwd: session.projectPath,
      env: {
        ...(process.env as { [key: string]: string }),
        CM_PORT: String(this.serverPort),
        CM_SESSION_ID: sessionId,
      }
    });

    ptyProcess.onData((data: string) => {
      this.handleOutput(sessionId, data);
    });

    ptyProcess.onExit(() => {
      this.handlePtyExit(sessionId);
    });

    this.ptys.set(sessionId, ptyProcess);

    if (isClaude) {
      // 监听 transcript 目录捕获 Claude CLI 的 sessionId（--resume 可能派生新 id）
      this.watchForTranscript(sessionId, session.projectPath);
      // 已有 claudeSessionId 但还没有标题的，直接尝试读取标题
      if (claudeSessionId && this.titleSources.get(sessionId) !== 'transcript') {
        this.watchForTitle(sessionId, session.projectPath);
      }
    }
  }

  // 进程退出：会话转休眠保留档案（应用关闭时的批量 kill 除外）
  private handlePtyExit(sessionId: string): void {
    this.clearTranscriptWatcher(sessionId);
    this.clearTitleWatcher(sessionId);
    this.ptys.delete(sessionId);
    this.inputLineBuffers.delete(sessionId);

    if (this.shuttingDown) return;

    const session = this.sessions.get(sessionId);
    if (!session) return; // 已被显式删除

    session.status = 'dormant';
    session.currentTask = '已休眠';
    session.outputBuffer = []; // 旧屏幕内容作废，唤醒后由 --resume 重绘
    this.refreshTranscriptInfo(sessionId);
    console.log(`[${sessionId.slice(0, 8)}] PTY exited, session dormant`);
    this.onStatusChange(session);
    this.persist();
  }

  // 轮询 ~/.claude/projects/<转义路径>/，新出现的 .jsonl 文件名即 Claude CLI 的 sessionId
  private watchForTranscript(sessionId: string, projectPath: string): void {
    const dir = claudeTranscriptDir(projectPath);
    const listTranscripts = (): string[] => {
      try {
        return readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => f.slice(0, -6));
      } catch {
        return []; // 目录还不存在
      }
    };

    const before = new Set(listTranscripts());

    const timer = setInterval(() => {
      const fresh = listTranscripts().filter(t => !before.has(t) && !this.claimedTranscripts.has(t));
      if (fresh.length === 0) return;

      const claudeSessionId = fresh[0];
      this.claimedTranscripts.add(claudeSessionId);
      this.claudeSessionIds.set(sessionId, claudeSessionId);
      this.clearTranscriptWatcher(sessionId);
      console.log(`[${sessionId.slice(0, 8)}] Captured claude sessionId: ${claudeSessionId}`);
      this.persist();
      // transcript 已就位，从中读取首条用户消息作为标题
      this.watchForTitle(sessionId, projectPath);
    }, TRANSCRIPT_POLL_INTERVAL);

    this.transcriptWatchers.set(sessionId, timer);
  }

  private clearTranscriptWatcher(sessionId: string): void {
    const timer = this.transcriptWatchers.get(sessionId);
    if (timer) {
      clearInterval(timer);
      this.transcriptWatchers.delete(sessionId);
    }
  }

  // 轮询 transcript，读到首条用户消息后设为标题（优先级最高，可覆盖输入行降级方案的结果）
  private watchForTitle(sessionId: string, projectPath: string): void {
    if (this.titleWatchers.has(sessionId)) return;

    const tryReadTitle = (): boolean => {
      const session = this.sessions.get(sessionId);
      const claudeSessionId = this.claudeSessionIds.get(sessionId);
      if (!session || !claudeSessionId) return true; // 会话已不在，停止
      if (this.titleSources.get(sessionId) === 'transcript') return true;

      const text = readFirstUserMessage(claudeTranscriptPath(projectPath, claudeSessionId));
      if (!text) return false;

      session.title = text.slice(0, TITLE_MAX_LENGTH);
      this.titleSources.set(sessionId, 'transcript');
      this.onStatusChange(session);
      this.persist();
      return true;
    };

    if (tryReadTitle()) return;
    const timer = setInterval(() => {
      if (tryReadTitle()) {
        this.clearTitleWatcher(sessionId);
      }
    }, TRANSCRIPT_POLL_INTERVAL);
    this.titleWatchers.set(sessionId, timer);
  }

  private clearTitleWatcher(sessionId: string): void {
    const timer = this.titleWatchers.get(sessionId);
    if (timer) {
      clearInterval(timer);
      this.titleWatchers.delete(sessionId);
    }
  }

  // Claude Code hooks 上报的状态事件（经 /api/claude-hook 转发）
  handleHookEvent(sessionId: string, event: string, payload: Record<string, unknown>): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const oldStatus = session.status;
    const oldTask = session.currentTask;
    const oldMessage = session.lastMessage;
    const oldTokens = session.contextTokens;

    switch (event) {
      case 'UserPromptSubmit':
        session.status = 'busy';
        session.currentTask = '正在思考';
        break;
      case 'PreToolUse':
        session.status = 'busy';
        session.currentTask = taskLabelForTool(String(payload.tool_name ?? ''));
        break;
      case 'PostToolUse':
        session.status = 'busy';
        session.currentTask = '正在思考';
        break;
      case 'Notification':
        // 权限确认或等待用户输入
        session.status = 'waiting';
        session.currentTask = '等待输入';
        break;
      case 'Stop':
        session.status = 'idle';
        session.currentTask = '空闲';
        // 一轮对话结束，刷新最后消息预览和上下文 token 量
        this.refreshTranscriptInfo(sessionId);
        break;
      default:
        return;
    }

    session.lastActivity = new Date();
    const changed = oldStatus !== session.status || oldTask !== session.currentTask
      || oldMessage !== session.lastMessage || oldTokens !== session.contextTokens;
    if (changed) {
      console.log(`[${sessionId.slice(0, 8)}] Hook ${event}: ${oldStatus} -> ${session.status}, Task: ${session.currentTask}`);
      this.onStatusChange(session);
    }
  }

  private handleOutput(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.outputBuffer.push(data);
    if (session.outputBuffer.length > MAX_BUFFER_CHUNKS) {
      session.outputBuffer = session.outputBuffer.slice(-MAX_BUFFER_CHUNKS);
    }

    session.lastActivity = new Date();
    this.onOutput(sessionId, data);
  }

  writeToSession(sessionId: string, data: string): void {
    const ptyProcess = this.ptys.get(sessionId);
    if (!ptyProcess) return;

    ptyProcess.write(data);
    this.feedTitleFallback(sessionId, data);
  }

  // 标题降级方案：累积用户输入直到回车，取整行做标题。
  // 仅在 transcript 标题尚未就位时生效（覆盖非 claude 会话及 transcript 出现前的窗口期）
  private feedTitleFallback(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if ((this.titleSources.get(sessionId) || 'default') !== 'default') return;

    const buffered = this.inputLineBuffers.get(sessionId) || '';
    const enterIndex = data.indexOf('\r');

    if (enterIndex === -1) {
      this.inputLineBuffers.set(sessionId, (buffered + data).slice(-500));
      return;
    }

    this.inputLineBuffers.set(sessionId, '');
    const title = cleanTypedLine(buffered + data.slice(0, enterIndex)).slice(0, TITLE_MAX_LENGTH);
    if (title) {
      session.title = title;
      this.titleSources.set(sessionId, 'typed');
      this.onStatusChange(session);
      this.persist();
    }
  }

  resizeSession(sessionId: string, cols: number, rows: number): void {
    const ptyProcess = this.ptys.get(sessionId);
    if (ptyProcess) {
      ptyProcess.resize(cols, rows);
    }
  }

  deleteSession(sessionId: string): void {
    this.clearTranscriptWatcher(sessionId);
    this.clearTitleWatcher(sessionId);
    const ptyProcess = this.ptys.get(sessionId);
    if (ptyProcess) {
      ptyProcess.kill();
    }
    this.sessions.delete(sessionId);
    this.ptys.delete(sessionId);
    this.inputLineBuffers.delete(sessionId);
    this.titleSources.delete(sessionId);
    this.launchCommands.delete(sessionId);
    this.claudeSessionIds.delete(sessionId);
    this.persist();
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

  // 清理所有会话（应用退出时调用），持久化记录保留供下次启动恢复
  destroyAll(): void {
    console.log(`Destroying all sessions (${this.ptys.size} total)`);
    this.shuttingDown = true;
    for (const [sessionId, ptyProcess] of this.ptys) {
      this.clearTranscriptWatcher(sessionId);
      this.clearTitleWatcher(sessionId);
      ptyProcess.kill();
    }
    this.sessions.clear();
    this.ptys.clear();
    this.launchCommands.clear();
    this.claudeSessionIds.clear();
    this.inputLineBuffers.clear();
    this.titleSources.clear();
  }
}
