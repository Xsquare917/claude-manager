import { useEffect, useRef } from 'react';
import { socketService } from '../services/socket';
import type { Session } from '../services/socket';
import { terminalRegistry } from '../services/terminalRegistry';
import '@xterm/xterm/css/xterm.css';

interface TerminalProps {
  session: Session;
  initialInput?: string;  // 初始填入的内容（不自动执行）
  onInitialInputSent?: () => void;  // 初始内容发送后的回调
}

// 薄壳组件：xterm 实例由 terminalRegistry 常驻管理（切换会话零重放），
// 组件只负责挂载/卸载 DOM、尺寸同步和指令模板注入
export default function Terminal({ session, initialInput, onInitialInputSent }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const prevStatusRef = useRef<string>(session.status);

  // 监听状态变化：完成时滚到底部、CLI 就绪时注入指令模板
  useEffect(() => {
    const entry = terminalRegistry.get(session.id);
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = session.status;
    if (!entry) return;

    if (prevStatus === 'busy' && (session.status === 'idle' || session.status === 'waiting')) {
      entry.xterm.scrollToBottom();
    }

    if (session.status === 'idle' && initialInput && entry.initialized && !entry.initialInputSent) {
      entry.initialInputSent = true;
      socketService.sendInput(session.id, initialInput);
      onInitialInputSent?.();
    }
  }, [session.status, session.id, initialInput, onInitialInputSent]);

  useEffect(() => {
    const container = terminalRef.current;
    if (!container) return;

    const sessionId = session.id;
    let mounted = true;
    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;

    const entry = terminalRegistry.attach(sessionId, container);

    // 尺寸同步（带防抖）
    const syncSize = () => {
      if (!mounted) return;
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (!mounted) return;
        entry.fitAddon.fit();
        const { cols, rows } = entry.xterm;
        if (entry.lastSize && entry.lastSize.cols === cols && entry.lastSize.rows === rows) {
          return;
        }
        entry.lastSize = { cols, rows };
        socketService.resizeTerminal(sessionId, cols, rows);
      }, 50);
    };

    const resizeObserver = new ResizeObserver(() => {
      if (mounted) requestAnimationFrame(syncSize);
    });
    resizeObserver.observe(container);
    window.addEventListener('resize', syncSize);

    // 初始化（延迟以确保 DOM 完全渲染）
    const initTimer = setTimeout(() => {
      if (!mounted) return;

      entry.fitAddon.fit();
      entry.lastSize = { cols: entry.xterm.cols, rows: entry.xterm.rows };
      socketService.resizeTerminal(sessionId, entry.xterm.cols, entry.xterm.rows);

      // 冷启动路径：首次挂载加载历史；常驻实例重新挂载时直接触发 resize 让 TUI 重绘
      terminalRegistry.loadHistoryOnce(sessionId, () => {
        if (!mounted) return;
        setTimeout(() => {
          if (!mounted) return;
          socketService.resizeTerminal(sessionId, entry.xterm.cols, entry.xterm.rows);
        }, 200);
      });

      if (entry.isAtBottom) {
        entry.xterm.scrollToBottom();
      }
      entry.xterm.focus();
    }, 100);

    // 终端获得焦点时触发 resize，让 PTY 重绘当前行同步光标位置
    const handleFocus = () => {
      if (!mounted || !entry.initialized) return;
      socketService.resizeTerminal(sessionId, entry.xterm.cols, entry.xterm.rows);
    };
    container.addEventListener('focus', handleFocus, true);

    return () => {
      mounted = false;
      clearTimeout(initTimer);
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeObserver.disconnect();
      window.removeEventListener('resize', syncSize);
      container.removeEventListener('focus', handleFocus, true);
      terminalRegistry.detach(sessionId);
    };
  }, [session.id]);

  const handleContainerClick = () => {
    terminalRegistry.get(session.id)?.xterm.focus();
  };

  return <div ref={terminalRef} className="terminal-container" onClick={handleContainerClick} />;
}
