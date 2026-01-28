import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { socketService } from '../services/socket';
import type { Session, SessionOutput } from '../services/socket';
import '@xterm/xterm/css/xterm.css';

interface TerminalProps {
  session: Session;
}

export default function Terminal({ session }: TerminalProps) {
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

    const xterm = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
      },
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
      if (output.data.includes('>') || output.data.includes('$') ||
          output.data.includes('?') || output.data.includes('[Y/n]')) {
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
      });
    });

    // 用户输入
    const dataDisposable = xterm.onData((data) => {
      if (mountedRef.current) {
        socketService.sendInput(currentSessionId, data);
      }
    });

    // 窗口 resize
    window.addEventListener('resize', handleSizeChange);

    // 监听输出
    socketService.on('session:output', handleOutput);

    return () => {
      mountedRef.current = false;
      initializedRef.current = false;
      pendingOutputRef.current = [];
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleSizeChange);
      socketService.off('session:output', handleOutput);
      dataDisposable.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      xterm.dispose();
    };
  }, [session.id]);

  return <div ref={terminalRef} className="terminal-container" />;
}
