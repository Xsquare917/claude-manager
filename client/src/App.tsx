import { useState, useEffect, useRef, useCallback } from 'react';
import { socketService } from './services/socket';
import type { Session } from './services/socket';
import Sidebar from './components/Sidebar';
import Terminal from './components/Terminal';
import StatusPanel from './components/StatusPanel';
import FloatingStatus from './components/FloatingStatus';
import AddProjectModal from './components/AddProjectModal';
import SettingsModal, { loadSettings, saveSettings } from './components/SettingsModal';
import type { AppSettings } from './components/SettingsModal';
import SetupGuide from './components/SetupGuide';
import './App.css';

function App() {
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showAddProject, setShowAddProject] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  // 过渡动画状态
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [maskPosition, setMaskPosition] = useState({ x: 50, y: 50 });
  // 用 ref 跟踪状态，避免闭包问题
  const activeSessionIdRef = useRef<string | null>(null);
  const sessionsRef = useRef<Session[]>([]);
  const settingsRef = useRef<AppSettings>(settings);
  activeSessionIdRef.current = activeSessionId;
  sessionsRef.current = sessions;
  settingsRef.current = settings;

  // 启动时检测 CLI 是否已安装
  useEffect(() => {
    // 使用版本号判断是否首次启动该版本
    const launchedVersion = localStorage.getItem('cm-setup-version');
    const isFirstLaunch = launchedVersion !== '1.0.0';

    // 首次启动必须显示引导页
    if (isFirstLaunch) {
      setSetupComplete(false);
      return;
    }

    // 非首次启动，检测是否都已安装
    Promise.all([
      fetch('/api/check-cli').then(r => r.json()),
      fetch('/api/check-node').then(r => r.json()),
    ])
      .then(([cli, node]) => {
        const allInstalled = cli.installed && node.installed;
        if (allInstalled) {
          setSetupComplete(true);
        } else {
          setSetupComplete(false);
        }
      })
      .catch(() => setSetupComplete(false));
  }, []);

  // 应用主题
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  const handleSaveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
  };

  // 选择会话时清除未读标记
  const handleSelectSession = useCallback((id: string) => {
    setActiveSessionId(id);
    setSessions(prev => prev.map(s =>
      s.id === id ? { ...s, unread: false } : s
    ));
  }, []);

  // 解析快捷键字符串
  const parseShortcut = (shortcut: string) => {
    const parts = shortcut.split('+');
    return {
      meta: parts.includes('⌘'),
      ctrl: parts.includes('Ctrl'),
      shift: parts.includes('Shift'),
      alt: parts.includes('Alt'),
      key: parts[parts.length - 1],
    };
  };

  const matchShortcut = (e: KeyboardEvent, shortcut: string) => {
    const s = parseShortcut(shortcut);
    const keyMatch = s.key === '↑' ? e.key === 'ArrowUp' :
                     s.key === '↓' ? e.key === 'ArrowDown' :
                     e.key.toUpperCase() === s.key;
    return (s.meta ? e.metaKey : true) &&
           (s.ctrl ? e.ctrlKey : true) &&
           (s.shift ? e.shiftKey : !e.shiftKey || s.shift) &&
           (s.alt ? e.altKey : true) &&
           keyMatch;
  };

  // 快捷键处理
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const shortcuts = settingsRef.current.shortcuts;

      // 添加新项目
      if (matchShortcut(e, shortcuts.addProject)) {
        e.preventDefault();
        setShowAddProject(true);
        return;
      }

      // 上一个会话
      if (matchShortcut(e, shortcuts.prevSession)) {
        e.preventDefault();
        const currentSessions = sessionsRef.current;
        if (currentSessions.length === 0) return;
        const currentIndex = currentSessions.findIndex(s => s.id === activeSessionIdRef.current);
        const newIndex = currentIndex <= 0 ? currentSessions.length - 1 : currentIndex - 1;
        handleSelectSession(currentSessions[newIndex].id);
        return;
      }

      // 下一个会话
      if (matchShortcut(e, shortcuts.nextSession)) {
        e.preventDefault();
        const currentSessions = sessionsRef.current;
        if (currentSessions.length === 0) return;
        const currentIndex = currentSessions.findIndex(s => s.id === activeSessionIdRef.current);
        const newIndex = currentIndex < 0 || currentIndex >= currentSessions.length - 1 ? 0 : currentIndex + 1;
        handleSelectSession(currentSessions[newIndex].id);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSelectSession]);

  useEffect(() => {
    const handleCreated = (session: Session) => {
      setSessions(prev => {
        // 防止重连时重复添加
        if (prev.some(s => s.id === session.id)) {
          return prev;
        }
        return [...prev, { ...session, unread: false }];
      });
    };

    const handleUpdated = (session: Session) => {
      setSessions(prev => prev.map(s => {
        if (s.id !== session.id) return s;

        // 从 busy 变为 waiting 或 idle 且不是当前活动会话，标记为未读
        const isActive = activeSessionIdRef.current === session.id;
        const busyToFinished = s.status === 'busy' && (session.status === 'waiting' || session.status === 'idle');
        const unread = busyToFinished && !isActive ? true : s.unread;

        return { ...session, unread };
      }));
    };

    const handleDeleted = (sessionId: string) => {
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      if (activeSessionIdRef.current === sessionId) {
        setActiveSessionId(null);
      }
    };

    const handleSummary = (data: { sessionId: string; summary: string; title: string }) => {
      setSessions(prev => prev.map(s =>
        s.id === data.sessionId ? { ...s, summary: data.summary, title: data.title } : s
      ));
    };

    socketService.on('session:created', handleCreated);
    socketService.on('session:updated', handleUpdated);
    socketService.on('session:deleted', handleDeleted);
    socketService.on('summary:updated', handleSummary);

    return () => {
      socketService.off('session:created', handleCreated);
      socketService.off('session:updated', handleUpdated);
      socketService.off('session:deleted', handleDeleted);
      socketService.off('summary:updated', handleSummary);
    };
  }, []);

  const activeSession = sessions.find(s => s.id === activeSessionId);

  // 加载中
  if (setupComplete === null) {
    return <div className="setup-guide"><div className="setup-container"><p style={{textAlign:'center',color:'#888'}}>加载中...</p></div></div>;
  }

  // 处理引导页完成的回调
  const handleSetupComplete = (buttonX: number, buttonY: number) => {
    setMaskPosition({ x: buttonX, y: buttonY });
    setIsTransitioning(true);
    setSetupComplete(true); // 立即加载主界面
    // 3.5秒后关闭遮罩
    setTimeout(() => setIsTransitioning(false), 3500);
  };

  // 显示引导页面（未完成或正在过渡中）
  const showSetupGuide = !setupComplete || isTransitioning;
  // 显示主界面（已完成或正在过渡中）
  const showMainContent = setupComplete || isTransitioning;

  return (
    <div className="app">
      {showMainContent && (
        <>
          <Sidebar
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelectSession={handleSelectSession}
            onAddProject={() => setShowAddProject(true)}
            onDeleteSession={(id) => socketService.deleteSession(id)}
            onDeleteProject={(ids) => ids.forEach(id => socketService.deleteSession(id))}
            onRefreshAllSummaries={(ids) => ids.forEach(id => socketService.requestSummary(id))}
            onOpenSettings={() => setShowSettings(true)}
          />
          <main className="main-content">
            {activeSession ? (
              <>
                <div className="terminal-wrapper">
                  <FloatingStatus session={activeSession} />
                  <Terminal key={activeSession.id} session={activeSession} />
                </div>
                <StatusPanel session={activeSession} />
              </>
            ) : (
              <div className="empty-state">
                <h2>欢迎使用 Claude Manager</h2>
                <p>点击左侧 "添加项目" 开始</p>
              </div>
            )}
          </main>
        </>
      )}
      {showAddProject && (
        <AddProjectModal
          onClose={() => setShowAddProject(false)}
          onAdd={async (path) => {
            const session = await socketService.createSession(path);
            if (session) {
              setActiveSessionId(session.id);
            } else {
              alert('创建会话失败，请检查后端日志');
            }
            setShowAddProject(false);
          }}
        />
      )}
      {showSettings && (
        <SettingsModal
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSave={handleSaveSettings}
        />
      )}
      {/* 过渡遮罩层 - 在主界面之上 */}
      {isTransitioning && (
        <div
          className="text-mask-container"
          style={{ '--mask-x': `${maskPosition.x}%`, '--mask-y': `${maskPosition.y}%` } as React.CSSProperties}
        >
          <svg className="text-mask-svg" viewBox="0 0 400 100" preserveAspectRatio="xMidYMid slice">
            <defs>
              <mask id="text-mask">
                {/* 白色背景 = 显示黑色遮罩 */}
                <rect width="100%" height="100%" fill="white" />
                {/* 黑色文字 = 透明镂空，显示下方主界面 */}
                <text
                  x="50%"
                  y="50%"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="mask-text"
                  fill="black"
                >
                  Xsquare
                </text>
              </mask>
            </defs>
            <rect width="100%" height="100%" fill="black" mask="url(#text-mask)" />
          </svg>
        </div>
      )}
      {/* 引导页 - 最底层 */}
      {showSetupGuide && (
        <SetupGuide
          onComplete={handleSetupComplete}
          isExiting={isTransitioning}
        />
      )}
    </div>
  );
}

export default App;
