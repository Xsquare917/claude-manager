import { useState, useEffect, useRef, useCallback } from 'react';
import { socketService } from './services/socket';
import type { Session } from './services/socket';
import Sidebar from './components/Sidebar';
import SplitView from './components/SplitView';
import StatusPanel from './components/StatusPanel';
import SettingsModal, { loadSettings, saveSettings } from './components/SettingsModal';
import type { AppSettings } from './components/SettingsModal';
import SetupGuide from './components/SetupGuide';
import UpdateModal from './components/UpdateModal';
import LaunchCommandModal from './components/LaunchCommandModal';
import {
  scheduleUpdateCheck,
  getPendingUpdate,
  type UpdateInfo,
} from './services/versionCheck';
import type { SplitState, DragState } from './types/split';
import { createSplitState } from './types/split';
import './App.css';

function App() {
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  // 过渡动画状态
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [maskPosition, setMaskPosition] = useState({ x: 50, y: 50 });
  // 版本更新状态
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  // 需要填入初始模板的会话ID
  const [pendingTemplateSessionId, setPendingTemplateSessionId] = useState<string | null>(null);
  // 分屏状态
  const [splitState, setSplitState] = useState<SplitState | null>(null);
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    sessionId: null,
    activeZone: null,
  });
  // 启动命令选择弹窗
  const [showLaunchCommandModal, setShowLaunchCommandModal] = useState(false);
  const [pendingProjectPath, setPendingProjectPath] = useState<string | null>(null);
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
    const isFirstLaunch = launchedVersion !== '1.2.5';

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
    const applyTheme = (theme: 'dark' | 'light' | 'system') => {
      if (theme === 'system') {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
      } else {
        document.documentElement.setAttribute('data-theme', theme);
      }
    };

    applyTheme(settings.theme);

    // 监听系统主题变化
    if (settings.theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = (e: MediaQueryListEvent) => {
        document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
      };
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    }
  }, [settings.theme]);

  // 版本更新检测
  useEffect(() => {
    // 检查是否有待显示的更新（上次检测到但未显示）
    const pending = getPendingUpdate();
    if (pending) {
      setUpdateInfo(pending);
      setShowUpdateModal(true);
    }

    // 定时检查更新（每24小时）
    scheduleUpdateCheck().then(info => {
      if (info?.hasUpdate) {
        setUpdateInfo(info);
        // 不立即弹窗，等下次启动时弹出
      }
    });
  }, []);

  const handleSaveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
  };

  // 打开目录选择器并显示启动命令选择弹窗
  const handleAddProject = useCallback(async () => {
    try {
      const res = await fetch('/api/pick-folder');
      const data = await res.json();
      if (data.path) {
        setPendingProjectPath(data.path);
        setShowLaunchCommandModal(true);
      }
    } catch (error) {
      console.error('Failed to add project:', error);
    }
  }, []);

  // 选择启动命令后创建会话
  const handleLaunchCommandSelect = useCallback(async (command: string) => {
    setShowLaunchCommandModal(false);
    if (!pendingProjectPath) return;

    try {
      const session = await socketService.createSession(pendingProjectPath, command);
      if (session) {
        setActiveSessionId(session.id);
        const template = settingsRef.current.promptTemplate;
        if (template) {
          setPendingTemplateSessionId(session.id);
        }
      } else {
        alert('创建会话失败，请检查后端日志');
      }
    } catch (error) {
      console.error('Failed to create session:', error);
    } finally {
      setPendingProjectPath(null);
    }
  }, [pendingProjectPath]);

  // 选择会话时清除未读标记，并更新分屏状态
  const handleSelectSession = useCallback((id: string) => {
    setActiveSessionId(id);
    setSessions(prev => prev.map(s =>
      s.id === id ? { ...s, unread: false } : s
    ));
    // 更新分屏状态：如果当前没有分屏，创建单面板；如果有分屏，更新焦点面板
    setSplitState(prev => {
      if (!prev) {
        return createSplitState(id);
      }
      // 如果选择的会话已在分屏中，切换焦点
      const idx = prev.sessions.indexOf(id);
      if (idx !== -1) {
        return { ...prev, focusedIndex: idx as 0 | 1 };
      }
      // 否则替换当前焦点面板
      if (prev.mode === 'single') {
        return { ...prev, sessions: [id] };
      }
      const newSessions = [...prev.sessions] as [string, string];
      newSessions[prev.focusedIndex] = id;
      return { ...prev, sessions: newSessions };
    });
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
        handleAddProject();
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
            onAddProject={handleAddProject}
            onDeleteSession={(id) => socketService.deleteSession(id)}
            onDeleteProject={(ids) => ids.forEach(id => socketService.deleteSession(id))}
            onOpenSettings={() => setShowSettings(true)}
            hasUpdate={updateInfo?.hasUpdate}
            onShowUpdate={() => setShowUpdateModal(true)}
            onDragStart={(sessionId) => setDragState({ isDragging: true, sessionId, activeZone: null })}
            onDragEnd={() => setDragState({ isDragging: false, sessionId: null, activeZone: null })}
          />
          <main className="main-content">
            <div className="main-titlebar" />
            {splitState ? (
              <>
                <div className="terminal-wrapper">
                  <SplitView
                    splitState={splitState}
                    sessions={sessions}
                    onSplitStateChange={setSplitState}
                    dragState={dragState}
                    onDragStateChange={setDragState}
                    pendingTemplateSessionId={pendingTemplateSessionId}
                    promptTemplate={settings.promptTemplate}
                    onInitialInputSent={() => setPendingTemplateSessionId(null)}
                  />
                </div>
                <StatusPanel session={sessions.find(s => s.id === splitState.sessions[splitState.focusedIndex])!} />
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
      {showSettings && (
        <SettingsModal
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSave={handleSaveSettings}
        />
      )}
      {showUpdateModal && updateInfo && (
        <UpdateModal
          updateInfo={updateInfo}
          onClose={() => setShowUpdateModal(false)}
        />
      )}
      {showLaunchCommandModal && (
        <LaunchCommandModal
          onSelect={handleLaunchCommandSelect}
          onCancel={() => {
            setShowLaunchCommandModal(false);
            setPendingProjectPath(null);
          }}
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
