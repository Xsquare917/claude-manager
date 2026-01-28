// Session types
export interface Session {
  id: string;
  projectPath: string;
  projectName: string;
  status: 'idle' | 'busy' | 'waiting';
  createdAt: Date;
  lastActivity: Date;
  outputBuffer: string[];
  currentTask: string;      // 动态刷新：当前在做什么
  summary: string;          // 手动刷新：对话概括
  title: string;            // 短标题（10字以内）
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
  'summary:updated': (data: { sessionId: string; summary: string; title: string }) => void;
  'status:updated': (data: { sessionId: string; currentTask: string }) => void;
}

export interface ClientToServerEvents {
  'session:create': (projectPath: string, callback: (session: Session | null) => void) => void;
  'session:input': (sessionId: string, data: string) => void;
  'session:resize': (sessionId: string, cols: number, rows: number) => void;
  'session:delete': (sessionId: string) => void;
  'session:getHistory': (sessionId: string, callback: (history: string) => void) => void;
  'session:requestSummary': (sessionId: string) => void;
  'project:create': (path: string) => void;
  'project:delete': (projectId: string) => void;
}
