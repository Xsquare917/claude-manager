import { useState } from 'react';

export interface AppSettings {
  theme: 'dark' | 'light';
  shortcuts: {
    addProject: string;
    prevSession: string;
    nextSession: string;
  };
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  shortcuts: {
    addProject: '⌘+Shift+O',
    prevSession: '⌘+↑',
    nextSession: '⌘+↓',
  },
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
    onSave({ theme, shortcuts });
    onClose();
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
            <div className="theme-options">
              <label className={`theme-option ${theme === 'dark' ? 'active' : ''}`}>
                <input
                  type="radio"
                  checked={theme === 'dark'}
                  onChange={() => setTheme('dark')}
                />
                <span className="theme-icon">🌙</span>
                <span>深色</span>
              </label>
              <label className={`theme-option ${theme === 'light' ? 'active' : ''}`}>
                <input
                  type="radio"
                  checked={theme === 'light'}
                  onChange={() => setTheme('light')}
                />
                <span className="theme-icon">☀️</span>
                <span>浅色</span>
              </label>
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
        </div>

        <div className="modal-actions">
          <button className="btn-cancel" onClick={onClose}>取消</button>
          <button className="btn-submit" onClick={handleSave}>保存</button>
        </div>
      </div>
    </div>
  );
}
