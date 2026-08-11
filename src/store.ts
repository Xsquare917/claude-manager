import { readFileSync, writeFileSync, mkdirSync, existsSync, openSync, readSync, closeSync, fstatSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// 持久化的会话元数据（对话内容由 Claude CLI 自己存储在 ~/.claude/projects/ 下）
export interface PersistedSession {
  id: string;                       // 应用内会话 ID
  projectPath: string;
  title: string;
  launchCommand: string;            // 原始启动命令（不含 --resume）
  claudeSessionId: string | null;   // Claude CLI 的会话 ID，用于 --resume 恢复
  createdAt: string;
}

export interface StoreData {
  sessions: PersistedSession[];
}

const storeDir = join(homedir(), '.claude-manager');
const storeFile = join(storeDir, 'state.json');

export function loadStore(): StoreData {
  try {
    const raw = readFileSync(storeFile, 'utf-8');
    const data = JSON.parse(raw);
    if (Array.isArray(data.sessions)) {
      return { sessions: data.sessions };
    }
  } catch {
    // 文件不存在或损坏，返回空状态
  }
  return { sessions: [] };
}

export function saveStore(data: StoreData): void {
  try {
    if (!existsSync(storeDir)) {
      mkdirSync(storeDir, { recursive: true });
    }
    writeFileSync(storeFile, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save store:', error);
  }
}

// Claude CLI 将项目路径中的非字母数字字符替换为 - 作为目录名
export function claudeTranscriptDir(projectPath: string): string {
  const escaped = projectPath.replace(/[^a-zA-Z0-9]/g, '-');
  return join(homedir(), '.claude', 'projects', escaped);
}

export function claudeTranscriptPath(projectPath: string, claudeSessionId: string): string {
  return join(claudeTranscriptDir(projectPath), `${claudeSessionId}.jsonl`);
}

// 生成 Claude Code hooks 配置文件，通过 --settings 注入 manager 拉起的会话。
// hook 命令从环境变量读取 CM_PORT / CM_SESSION_ID（由 pty spawn 时注入），
// 将事件 POST 回 manager；-m 2 保证 manager 不在时不阻塞会话。
export function writeHooksSettingsFile(): string {
  const hookCommand = (event: string) =>
    `curl -s -m 2 -X POST -H "Content-Type: application/json" --data-binary @- ` +
    `"http://127.0.0.1:\${CM_PORT}/api/claude-hook?event=${event}&session=\${CM_SESSION_ID}" >/dev/null 2>&1 || true`;
  const entry = (event: string, matcher?: string) => [{
    ...(matcher ? { matcher } : {}),
    hooks: [{ type: 'command', command: hookCommand(event), timeout: 5 }],
  }];

  const settings = {
    hooks: {
      UserPromptSubmit: entry('UserPromptSubmit'),
      PreToolUse: entry('PreToolUse', '*'),
      PostToolUse: entry('PostToolUse', '*'),
      Notification: entry('Notification'),
      Stop: entry('Stop'),
    },
  };

  if (!existsSync(storeDir)) {
    mkdirSync(storeDir, { recursive: true });
  }
  const filePath = join(storeDir, 'claude-hooks.json');
  writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
  return filePath;
}

// 从 transcript 中读取首条用户消息（只读文件头部，避免大文件全量加载）
export function readFirstUserMessage(transcriptPath: string): string | null {
  let raw: string;
  try {
    const fd = openSync(transcriptPath, 'r');
    const buf = Buffer.alloc(256 * 1024);
    const bytesRead = readSync(fd, buf, 0, buf.length, 0);
    closeSync(fd);
    raw = buf.toString('utf-8', 0, bytesRead);
  } catch {
    return null;
  }

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let record: {
      type?: string;
      isMeta?: boolean;
      message?: { content?: string | Array<{ type?: string; text?: string }> };
    };
    try {
      record = JSON.parse(line);
    } catch {
      continue; // 末行可能因截断不完整
    }
    if (record.type !== 'user' || record.isMeta) continue;

    const content = record.message?.content;
    let text = '';
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      text = content.find(b => b?.type === 'text' && typeof b.text === 'string')?.text || '';
    }
    text = text.trim();
    // 跳过 /command 等系统注入的伪用户消息
    if (!text || text.startsWith('<')) continue;
    return text.replace(/\s+/g, ' ');
  }
  return null;
}

interface TranscriptRecord {
  type?: string;
  isMeta?: boolean;
  message?: {
    content?: string | Array<{ type?: string; text?: string }>;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

function extractText(record: TranscriptRecord): string {
  const content = record.message?.content;
  let text = '';
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = content.find(b => b?.type === 'text' && typeof b.text === 'string')?.text || '';
  }
  text = text.trim();
  if (!text || text.startsWith('<')) return '';
  return text.replace(/\s+/g, ' ');
}

export interface TranscriptTailInfo {
  lastMessage: string | null;
  contextTokens: number | null;
}

// 从 transcript 尾部提取最后一条消息预览和当前上下文 token 量
export function readTranscriptTail(transcriptPath: string): TranscriptTailInfo {
  const result: TranscriptTailInfo = { lastMessage: null, contextTokens: null };
  let raw: string;
  let truncated = false;
  try {
    const fd = openSync(transcriptPath, 'r');
    const size = fstatSync(fd).size;
    const length = Math.min(size, 128 * 1024);
    const buf = Buffer.alloc(length);
    readSync(fd, buf, 0, length, size - length);
    closeSync(fd);
    raw = buf.toString('utf-8');
    truncated = size > length;
  } catch {
    return result;
  }

  const lines = raw.split('\n');
  const start = truncated ? 1 : 0; // 截断读取时首行可能不完整

  for (let i = lines.length - 1; i >= start; i--) {
    if (!lines[i].trim()) continue;
    let record: TranscriptRecord;
    try {
      record = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (record.isMeta) continue;

    if (result.contextTokens === null && record.type === 'assistant') {
      const usage = record.message?.usage;
      if (usage) {
        result.contextTokens =
          (usage.input_tokens || 0) +
          (usage.cache_creation_input_tokens || 0) +
          (usage.cache_read_input_tokens || 0) +
          (usage.output_tokens || 0);
      }
    }

    if (result.lastMessage === null && (record.type === 'user' || record.type === 'assistant')) {
      const text = extractText(record);
      if (text) {
        result.lastMessage = text.slice(0, 80);
      }
    }

    if (result.lastMessage !== null && result.contextTokens !== null) break;
  }
  return result;
}
