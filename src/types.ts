// Session types
export interface Session {
  id: string;
  projectPath: string;
  projectName: string;
  status: 'idle' | 'busy' | 'waiting' | 'dormant';  // dormant: 进程未运行，点击唤醒
  createdAt: Date;
  lastActivity: Date;
  outputBuffer: string[];
  currentTask: string;      // 动态刷新：当前在做什么
  title: string;            // 短标题（10字以内）
  lastMessage: string | null;    // transcript 中最后一条消息预览
  contextTokens: number | null;  // 当前上下文 token 量（最近一轮 usage 合计）
}

export interface Project {
  id: string;
  name: string;
  path: string;
  sessions: string[];       // session ids
}

export interface SessionOutput {
  sessionId: string;
  data: string;
  timestamp: Date;
}

// WebSocket events
export interface ServerToClientEvents {
  'session:created': (session: Session) => void;
  'session:updated': (session: Session) => void;
  'session:deleted': (sessionId: string) => void;
  'session:output': (output: SessionOutput) => void;
  'project:created': (project: Project) => void;
  'project:updated': (project: Project) => void;
  'project:deleted': (projectId: string) => void;
  'status:updated': (data: { sessionId: string; currentTask: string }) => void;
}

export interface ClientToServerEvents {
  'session:create': (projectPath: string, launchCommand: string, callback: (session: Session | null) => void) => void;
  'session:input': (sessionId: string, data: string) => void;
  'session:resize': (sessionId: string, cols: number, rows: number) => void;
  'session:delete': (sessionId: string) => void;
  'session:wake': (sessionId: string) => void;
  'session:getHistory': (sessionId: string, callback: (history: string) => void) => void;
  'project:create': (path: string) => void;
  'project:delete': (projectId: string) => void;
}
