import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { socketService } from './socket';
import { linkPopover } from './linkPopover';
import type { SessionOutput } from './socket';

// 终端恒定使用深色主题：CLI 配色绝大多数按深色背景设计，
// 不做任何颜色干预才能保证原始观感（应用 UI 主题不影响终端区域）
const terminalTheme = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  cursor: '#d4d4d4',
  cursorAccent: '#1e1e1e',
  selectionBackground: '#264f78',
  // ANSI 颜色 (标准 16 色)
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#ffffff',
};

export interface TerminalEntry {
  xterm: XTerm;
  fitAddon: FitAddon;
  initialized: boolean;         // 历史加载完成
  historyRequested: boolean;
  isAtBottom: boolean;          // 智能滚动：用户是否在底部
  initialInputSent: boolean;    // 指令模板是否已注入
  lastSize: { cols: number; rows: number } | null;
}

interface InternalEntry extends TerminalEntry {
  pendingOutput: string[];
  outputHandler: (output: SessionOutput) => void;
}

const entries = new Map<string, InternalEntry>();

// 会话切换时 xterm 的 DOM 停放处（保持在文档中，实例可继续接收输出）
let parkEl: HTMLDivElement | null = null;
function park(): HTMLDivElement {
  if (!parkEl) {
    parkEl = document.createElement('div');
    parkEl.style.display = 'none';
    document.body.appendChild(parkEl);
  }
  return parkEl;
}

// 挂载会话终端到容器：实例已存在则移入 DOM（零重放），否则创建并订阅输出
function attach(sessionId: string, container: HTMLElement): TerminalEntry {
  const existing = entries.get(sessionId);
  if (existing) {
    const el = existing.xterm.element;
    if (el && el.parentElement !== container) {
      container.appendChild(el);
      // DOM 移动后 canvas 内容丢失，强制重绘
      existing.xterm.refresh(0, Math.max(existing.xterm.rows - 1, 0));
    }
    return existing;
  }

  const xterm = new XTerm({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    theme: terminalTheme,
    // OSC 8 真超链接（现代 CLI 输出的链接转义序列）：悬停弹操作卡，点击文本无动作
    linkHandler: {
      activate: () => {},
      hover: (event, text) => linkPopover.showSoon(text, event.clientX, event.clientY),
      leave: () => linkPopover.scheduleHide(),
    },
  });
  const fitAddon = new FitAddon();
  xterm.loadAddon(fitAddon);
  // 纯文本 URL 识别：同样走悬停操作卡
  xterm.loadAddon(new WebLinksAddon(() => {}, {
    hover: (event, text) => linkPopover.showSoon(text, event.clientX, event.clientY),
    leave: () => linkPopover.scheduleHide(),
  }));
  xterm.open(container);

  // 让全局快捷键能够冒泡到 window 处理
  xterm.attachCustomKeyEventHandler((e) => {
    const isMod = e.metaKey || e.ctrlKey;
    if (isMod && (e.shiftKey || ['ArrowUp', 'ArrowDown'].includes(e.key))) {
      return false;
    }
    return true;
  });

  const entry: InternalEntry = {
    xterm,
    fitAddon,
    initialized: false,
    historyRequested: false,
    isAtBottom: true,
    initialInputSent: false,
    lastSize: null,
    pendingOutput: [],
    outputHandler: () => {},
  };

  xterm.onData((data) => {
    socketService.sendInput(sessionId, data);
    entry.isAtBottom = true;
    xterm.scrollToBottom();
  });

  xterm.onScroll(() => {
    const buffer = xterm.buffer.active;
    entry.isAtBottom = buffer.viewportY >= buffer.baseY;
    // 滚动后链接位置漂移，收起操作卡
    linkPopover.hideNow();
  });

  // 输出直接写入常驻实例，无论当前是否可见
  entry.outputHandler = (output: SessionOutput) => {
    if (output.sessionId !== sessionId) return;
    if (!entry.initialized) {
      entry.pendingOutput.push(output.data);
      return;
    }
    xterm.write(output.data);
    if (entry.isAtBottom) {
      xterm.scrollToBottom();
    }
  };
  socketService.on('session:output', entry.outputHandler);

  entries.set(sessionId, entry);
  return entry;
}

// 首次挂载时从服务端加载历史（应用重启后的冷启动路径）；实例常驻后不再走这里
function loadHistoryOnce(sessionId: string, onReady?: () => void): void {
  const entry = entries.get(sessionId);
  if (!entry) return;
  if (entry.historyRequested) {
    if (entry.initialized) onReady?.();
    return;
  }
  entry.historyRequested = true;

  socketService.getSessionHistory(sessionId).then((history) => {
    const current = entries.get(sessionId);
    if (!current || current !== entry) return;

    if (history) {
      entry.xterm.write(history);
    }
    entry.initialized = true;
    // 历史已包含缓存期间的输出，直接丢弃
    entry.pendingOutput = [];
    entry.xterm.scrollToBottom();
    onReady?.();
  });
}

// 面板卸载：只把 DOM 挪到停放处，实例与缓冲全部保留
function detach(sessionId: string): void {
  linkPopover.hideNow();
  const el = entries.get(sessionId)?.xterm.element;
  if (el) {
    park().appendChild(el);
  }
}

// 会话被删除时才真正销毁实例
function dispose(sessionId: string): void {
  const entry = entries.get(sessionId);
  if (!entry) return;
  socketService.off('session:output', entry.outputHandler);
  entry.xterm.dispose();
  entries.delete(sessionId);
}

function get(sessionId: string): TerminalEntry | undefined {
  return entries.get(sessionId);
}

export const terminalRegistry = { attach, loadHistoryOnce, detach, dispose, get };
