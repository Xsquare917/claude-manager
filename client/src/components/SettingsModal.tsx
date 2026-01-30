import { useState } from 'react';
import { getCurrentVersion, checkForUpdates, type UpdateInfo } from '../services/versionCheck';

export interface AppSettings {
  theme: 'dark' | 'light' | 'system';
  shortcuts: {
    addProject: string;
    prevSession: string;
    nextSession: string;
  };
  promptTemplate: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  shortcuts: {
    addProject: '⌘+Shift+O',
    prevSession: '⌘+↑',
    nextSession: '⌘+↓',
  },
  promptTemplate: '',
};

interface SettingsModalProps {
  onClose: () => void;
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
}

export function loadSettings(): AppSettings {
  try {
    const saved = localStorage.getItem('claude-manager-settings');
    if (saved) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    }
  } catch {}
  return DEFAULT_SETTINGS;
}

export function saveSettings(settings: AppSettings) {
  localStorage.setItem('claude-manager-settings', JSON.stringify(settings));
}

export default function SettingsModal({ onClose, settings, onSave }: SettingsModalProps) {
  const [theme, setTheme] = useState(settings.theme);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [shortcuts, setShortcuts] = useState(settings.shortcuts);
  const [promptTemplate, setPromptTemplate] = useState(settings.promptTemplate || '');
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateInfo | null | 'error'>(null);

  const handleThemeChange = (newTheme: 'dark' | 'light' | 'system') => {
    setTheme(newTheme);
    onSave({ ...settings, theme: newTheme, shortcuts, promptTemplate });
  };

  const handleKeyCapture = (e: React.KeyboardEvent, key: keyof typeof shortcuts) => {
    e.preventDefault();
    const parts: string[] = [];
    if (e.metaKey) parts.push('⌘');
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');

    const keyName = e.key === 'ArrowUp' ? '↑' : e.key === 'ArrowDown' ? '↓' : e.key.toUpperCase();
    if (!['Meta', 'Control', 'Shift', 'Alt'].includes(e.key)) {
      parts.push(keyName);
    }

    if (parts.length > 1) {
      setShortcuts(prev => ({ ...prev, [key]: parts.join('+') }));
      setEditingKey(null);
    }
  };

  const handleSave = () => {
    onSave({ theme, shortcuts, promptTemplate });
    onClose();
  };

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateResult(null);
    try {
      const result = await checkForUpdates();
      setUpdateResult(result || 'error');
    } catch {
      setUpdateResult('error');
    } finally {
      setCheckingUpdate(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>设置</h2>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>

        <div className="settings-content">
          <div className="settings-section">
            <h3>主题</h3>
            <div className="theme-toggle-wrapper">
              <span className={`theme-label ${theme === 'dark' ? 'active' : ''}`}>
                <span className="theme-icon">🌙</span>
                深色
              </span>
              <button
                className={`theme-toggle ${theme === 'light' ? 'light' : ''} ${theme === 'system' ? 'system' : ''}`}
                onClick={() => handleThemeChange(theme === 'light' ? 'dark' : 'light')}
                aria-label="切换主题"
              >
                <span className="toggle-slider" />
              </button>
              <span className={`theme-label ${theme === 'light' ? 'active' : ''}`}>
                <span className="theme-icon">☀️</span>
                浅色
              </span>
              <button
                className={`theme-option system ${theme === 'system' ? 'active' : ''}`}
                onClick={() => handleThemeChange('system')}
              >
                <span className="theme-icon">💻</span>
                跟随系统
              </button>
            </div>
          </div>

          <div className="settings-section">
            <h3>快捷键</h3>
            <div className="shortcut-list">
              {Object.entries(shortcuts).map(([key, value]) => (
                <div key={key} className="shortcut-item">
                  <span className="shortcut-label">
                    {key === 'addProject' && '添加项目'}
                    {key === 'prevSession' && '上一个会话'}
                    {key === 'nextSession' && '下一个会话'}
                  </span>
                  <button
                    className={`shortcut-key ${editingKey === key ? 'editing' : ''}`}
                    onClick={() => setEditingKey(key)}
                    onKeyDown={e => editingKey === key && handleKeyCapture(e, key as keyof typeof shortcuts)}
                  >
                    {editingKey === key ? '按下快捷键...' : value}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="settings-section">
            <h3>常用指令模板</h3>
            <p className="settings-hint">创建新会话时自动填入此内容（不会自动执行）</p>
            <textarea
              className="prompt-template-input"
              value={promptTemplate}
              onChange={e => setPromptTemplate(e.target.value)}
              placeholder="输入常用的指令模板，例如：请帮我分析这个项目的代码结构..."
              rows={4}
            />
          </div>

          <div className="settings-section">
            <h3>关于</h3>
            <div className="about-info">
              <span className="about-label">当前版本</span>
              <div className="about-version-row">
                <button
                  className="btn-check-update"
                  onClick={handleCheckUpdate}
                  disabled={checkingUpdate}
                >
                  {checkingUpdate ? '检测中...' : '检测更新'}
                </button>
                <span className="about-value">v{getCurrentVersion()}</span>
              </div>
            </div>
            {updateResult && updateResult !== 'error' && (
              <div className={`update-result ${updateResult.hasUpdate ? 'has-update' : 'up-to-date'}`}>
                {updateResult.hasUpdate ? (
                  <>
                    <span>发现新版本: v{updateResult.latestVersion}</span>
                    <a href={updateResult.downloadUrl} target="_blank" rel="noopener noreferrer">
                      前往下载
                    </a>
                  </>
                ) : (
                  <span>已是最新版本</span>
                )}
              </div>
            )}
            {updateResult === 'error' && (
              <div className="update-result error">
                <span>检测失败，请稍后重试</span>
              </div>
            )}
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn-cancel" onClick={onClose}>取消</button>
          <button className="btn-submit" onClick={handleSave}>保存</button>
        </div>
      </div>
    </div>
  );
}
