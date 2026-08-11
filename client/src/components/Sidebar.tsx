import { useState } from 'react';
import type { Session } from '../services/socket';

interface SidebarProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onAddProject: () => void;
  onAddSession: (projectPath: string) => void;
  onDeleteSession: (id: string) => void;
  onDeleteProject: (sessionIds: string[]) => void;
  onOpenSettings: () => void;
  hasUpdate?: boolean;
  onShowUpdate?: () => void;
  onDragStart?: (sessionId: string) => void;
  onDragEnd?: () => void;
}

// 按项目分组会话，未读的排在前面
function groupByProject(sessions: Session[]) {
  const groups: Record<string, Session[]> = {};
  sessions.forEach(session => {
    const key = session.projectPath;
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(session);
  });

  // 每个项目内，未读的会话排在前面
  Object.keys(groups).forEach(key => {
    groups[key].sort((a, b) => {
      if (a.unread && !b.unread) return -1;
      if (!a.unread && b.unread) return 1;
      return 0;
    });
  });

  return groups;
}

// 对项目排序，保持原有顺序
function sortedGroupEntries(groups: Record<string, Session[]>) {
  return Object.entries(groups);
}

function getStatusIcon(status: Session['status']) {
  switch (status) {
    case 'busy': return '🔄';
    case 'waiting': return '💬';
    case 'dormant': return '💤';
    default: return '✅';
  }
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

export default function Sidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onAddProject,
  onAddSession,
  onDeleteSession,
  onDeleteProject,
  onOpenSettings,
  hasUpdate,
  onShowUpdate,
  onDragStart,
  onDragEnd,
}: SidebarProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const grouped = groupByProject(sessions);
  const sortedGroups = sortedGroupEntries(grouped);

  // 获取当前活动会话所属的项目路径
  const activeSession = sessions.find(s => s.id === activeSessionId);
  const activeProjectPath = activeSession?.projectPath || null;

  return (
    <aside className="sidebar">
      {/* macOS 窗口控制按钮预留区域 */}
      <div className="macos-titlebar">
        {hasUpdate && (
          <button className="update-badge" onClick={onShowUpdate}>
            新版本
          </button>
        )}
      </div>
      <div className="sidebar-header">
        <div className="sidebar-title">
          <h1>Claude Manager</h1>
          <button className="btn-settings" onClick={onOpenSettings} onMouseDown={(e) => e.preventDefault()} title="设置">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>
            </svg>
          </button>
        </div>
        <button className="btn-add" onClick={onAddProject} onMouseDown={(e) => e.preventDefault()}>
          + 添加项目
        </button>
      </div>

      <div className="project-list">
        {sortedGroups.map(([projectPath, projectSessions]) => {
          const isActiveProject = projectPath === activeProjectPath;
          return (
            <div key={projectPath} className={`project-group ${isActiveProject ? 'active' : ''}`}>
              <div className="project-header">
                <span className="project-name">{projectSessions[0].projectName}</span>
                <button
                  className="btn-add-session"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onAddSession(projectPath)}
                  title="新建会话"
                >
                  +
                </button>
                <button
                  className="btn-delete-project"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onDeleteProject(projectSessions.map(s => s.id))}
                  title="删除整个项目"
                >
                  ×
                </button>
              </div>
              <div className="session-list">
                {projectSessions.map((session) => (
                  <div
                    key={session.id}
                    className={`session-item ${session.id === activeSessionId ? 'active' : ''} ${draggingId === session.id ? 'dragging' : ''}`}
                    onClick={() => onSelectSession(session.id)}
                    draggable
                    onDragStart={(e) => {
                      setDraggingId(session.id);
                      e.dataTransfer.setData('text/plain', session.id);
                      e.dataTransfer.effectAllowed = 'move';
                      onDragStart?.(session.id);
                    }}
                    onDragEnd={() => {
                      setDraggingId(null);
                      onDragEnd?.();
                    }}
                  >
                    <div className="session-main">
                      <span className="status-icon">{getStatusIcon(session.status)}</span>
                      <span className="session-name">{session.title || '新会话'}</span>
                      {session.unread && <span className="unread-dot" />}
                      <button
                        className="btn-delete"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteSession(session.id);
                        }}
                      >
                        ×
                      </button>
                    </div>
                    {(session.lastMessage || session.contextTokens) && (
                      <div className="session-preview">
                        <span className="preview-text">{session.lastMessage || ''}</span>
                        {session.contextTokens ? (
                          <span className="preview-tokens">{formatTokens(session.contextTokens)}</span>
                        ) : null}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
