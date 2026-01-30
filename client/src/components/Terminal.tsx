import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { socketService } from '../services/socket';
import type { Session, SessionOutput } from '../services/socket';
import '@xterm/xterm/css/xterm.css';

interface TerminalProps {
  session: Session;
  initialInput?: string;  // 初始填入的内容（不自动执行）
  onInitialInputSent?: () => void;  // 初始内容发送后的回调
}

const darkTheme = {
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

const lightTheme = {
  background: '#ffffff',
  foreground: '#1a1a1a',
  cursor: '#b48ead',
  cursorAccent: '#ffffff',
  selectionBackground: '#add6ff',
  // ANSI 颜色 - 为浅色背景优化
  // 所有颜色都需要在白色背景上清晰可见
  black: '#4a4a4a',         // 黑色改为中灰，避免太深
  red: '#c72e2e',
  green: '#118c4e',
  yellow: '#9d8500',        // 深黄色，避免太浅
  blue: '#0451a5',
  magenta: '#a626a4',
  cyan: '#0598bc',
  white: '#383838',         // 白色改为深灰色（代码块文字常用此颜色）
  brightBlack: '#5c5c5c',   // 亮黑改为中灰
  brightRed: '#e45649',
  brightGreen: '#50a14f',
  brightYellow: '#986801',  // 深黄色
  brightBlue: '#4078f2',
  brightMagenta: '#c678dd',
  brightCyan: '#0184bc',
  brightWhite: '#2a2a2a',   // 亮白改为更深的灰色（代码块文字常用此颜色）
};

export default function Terminal({ session, initialInput, onInitialInputSent }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const prevStatusRef = useRef<string>(session.status);
  const mountedRef = useRef<boolean>(true);
  const boundSessionIdRef = useRef<string>(session.id);
  const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  // 标记是否已完成初始化（历史加载完成）
  const initializedRef = useRef<boolean>(false);
  // 缓存初始化期间收到的输出
  const pendingOutputRef = useRef<string[]>([]);
  // 标记用户是否在底部（用于智能滚动）
  const isAtBottomRef = useRef<boolean>(true);
  // 标记初始输入是否已发送
  const initialInputSentRef = useRef<boolean>(false);

  // 监听状态变化
  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    const currentStatus = session.status;

    if (prevStatus === 'busy' && (currentStatus === 'idle' || currentStatus === 'waiting')) {
      xtermRef.current?.scrollToBottom();
    }
    prevStatusRef.current = currentStatus;
  }, [session.status]);

  useEffect(() => {
    if (!terminalRef.current) return;

    const container = terminalRef.current;
    const currentSessionId = session.id;

    mountedRef.current = true;
    boundSessionIdRef.current = currentSessionId;
    initializedRef.current = false;
    pendingOutputRef.current = [];
    initialInputSentRef.current = false;
    isAtBottomRef.current = true;  // 重置滚动状态

    const getTheme = () => {
      const theme = document.documentElement.getAttribute('data-theme');
      return theme === 'light' ? lightTheme : darkTheme;
    };

    const xterm = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: getTheme(),
    });

    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.open(container);

    // 让全局快捷键能够冒泡到 window 处理
    xterm.attachCustomKeyEventHandler((e) => {
      const isMod = e.metaKey || e.ctrlKey;
      // 带修饰键的快捷键让其冒泡到 window
      if (isMod && (e.shiftKey || ['ArrowUp', 'ArrowDown'].includes(e.key))) {
        return false;
      }
      return true;
    });

    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;

    // 处理尺寸变化
    const handleSizeChange = () => {
      if (!mountedRef.current || !fitAddonRef.current || !xtermRef.current) return;

      fitAddonRef.current.fit();
      const cols = xtermRef.current.cols;
      const rows = xtermRef.current.rows;

      const lastSize = lastSizeRef.current;
      if (lastSize && lastSize.cols === cols && lastSize.rows === rows) {
        return;
      }

      lastSizeRef.current = { cols, rows };
      socketService.resizeTerminal(currentSessionId, cols, rows);
    };

    // 输出处理函数
    const handleOutput = (output: SessionOutput) => {
      if (!mountedRef.current) return;
      if (output.sessionId !== currentSessionId) return;
      if (!xtermRef.current) return;

      // 如果还没初始化完成，缓存输出
      if (!initializedRef.current) {
        pendingOutputRef.current.push(output.data);
        return;
      }

      xtermRef.current.write(output.data);
      // 只有当用户本来就在底部时才自动滚动
      if (isAtBottomRef.current) {
        xtermRef.current.scrollToBottom();
      }
    };

    // ResizeObserver 监听容器尺寸
    const resizeObserver = new ResizeObserver(() => {
      if (!mountedRef.current) return;
      requestAnimationFrame(handleSizeChange);
    });
    resizeObserver.observe(container);

    // 初始化
    requestAnimationFrame(() => {
      if (!mountedRef.current || !fitAddonRef.current || !xtermRef.current) return;
      fitAddonRef.current.fit();
      const cols = xtermRef.current.cols;
      const rows = xtermRef.current.rows;
      lastSizeRef.current = { cols, rows };
      socketService.resizeTerminal(currentSessionId, cols, rows);

      // 加载历史
      socketService.getSessionHistory(currentSessionId).then((history) => {
        if (!mountedRef.current || boundSessionIdRef.current !== currentSessionId) return;
        if (!xtermRef.current) return;

        // 写入历史
        if (history) {
          xtermRef.current.write(history);
        }

        // 标记初始化完成
        initializedRef.current = true;

        // 写入缓存的输出（只写入历史之后的新内容）
        // 由于历史已经包含了之前的输出，这里清空缓存即可
        pendingOutputRef.current = [];

        // 滚动到底部，确保光标在输入行
        xtermRef.current.scrollToBottom();

        // 多次延迟 resize 来同步光标位置
        // 历史记录中可能包含 ANSI 光标定位序列，导致 xterm 光标与 PTY 不同步
        // 通过多次 resize 触发 PTY 重绘当前行，确保光标位置正确
        const syncCursorPosition = (delay: number) => {
          setTimeout(() => {
            if (!mountedRef.current || !xtermRef.current) return;
            if (boundSessionIdRef.current !== currentSessionId) return;

            const cols = xtermRef.current.cols;
            const rows = xtermRef.current.rows;
            socketService.resizeTerminal(currentSessionId, cols, rows);
          }, delay);
        };

        // 分多次 resize，确保 PTY 有足够时间响应并重绘
        syncCursorPosition(50);
        syncCursorPosition(150);
        syncCursorPosition(300);

        // 聚焦终端
        xtermRef.current.focus();

        // 如果有初始输入且尚未发送，延迟发送（等待 CLI 就绪）
        if (initialInput && !initialInputSentRef.current) {
          initialInputSentRef.current = true;
          setTimeout(() => {
            if (mountedRef.current && boundSessionIdRef.current === currentSessionId) {
              socketService.sendInput(currentSessionId, initialInput);
              onInitialInputSent?.();
            }
          }, 800);
        }
      });
    });

    // 用户输入
    const dataDisposable = xterm.onData((data) => {
      if (mountedRef.current) {
        socketService.sendInput(currentSessionId, data);
        // 用户输入后滚动到底部
        isAtBottomRef.current = true;
        xtermRef.current?.scrollToBottom();
      }
    });

    // 监听滚动事件，判断用户是否在底部
    const scrollDisposable = xterm.onScroll(() => {
      if (!xtermRef.current) return;
      const buffer = xtermRef.current.buffer.active;
      const viewportY = buffer.viewportY;
      const baseY = buffer.baseY;
      // 如果 viewportY 等于 baseY，说明在底部
      isAtBottomRef.current = viewportY >= baseY;
    });

    // 监听主题变化
    const themeObserver = new MutationObserver(() => {
      if (!xtermRef.current) return;
      xtermRef.current.options.theme = getTheme();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    // 窗口 resize
    window.addEventListener('resize', handleSizeChange);

    // 监听输出
    socketService.on('session:output', handleOutput);

    return () => {
      mountedRef.current = false;
      initializedRef.current = false;
      pendingOutputRef.current = [];
      isAtBottomRef.current = true;  // 重置滚动状态
      resizeObserver.disconnect();
      themeObserver.disconnect();
      window.removeEventListener('resize', handleSizeChange);
      socketService.off('session:output', handleOutput);
      dataDisposable.dispose();
      scrollDisposable.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      xterm.dispose();
    };
  }, [session.id]);

  const handleContainerClick = () => {
    xtermRef.current?.focus();
  };

  return <div ref={terminalRef} className="terminal-container" onClick={handleContainerClick} />;
}
