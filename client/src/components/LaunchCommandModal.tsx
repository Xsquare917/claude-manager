import { useState } from 'react';

interface LaunchCommandModalProps {
  onSelect: (command: string) => void;
  onCancel: () => void;
  cliStatus: Record<string, boolean>;
}

export default function LaunchCommandModal({ onSelect, onCancel, cliStatus }: LaunchCommandModalProps) {
  const [command, setCommand] = useState('claude');

  const getButtonClass = (cli: string) => {
    if (cliStatus[cli] === undefined) return 'btn-cli';
    return cliStatus[cli] ? 'btn-cli installed' : 'btn-cli not-installed';
  };

  const handleConfirm = () => {
    if (command.trim()) {
      onSelect(command.trim());
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal launch-command-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>选择启动命令</h2>
          <button className="btn-close" onClick={onCancel}>×</button>
        </div>
        <div className="modal-content">
          <p className="modal-hint">请选择或输入要使用的 AI CLI 工具</p>
          <div className="cli-buttons">
            <button className={getButtonClass('claude')} onClick={() => setCommand('claude')}>
              Claude
            </button>
            <button className={getButtonClass('codex')} onClick={() => setCommand('codex')}>
              Codex
            </button>
            <button className={getButtonClass('gemini')} onClick={() => setCommand('gemini')}>
              Gemini
            </button>
          </div>
          <div className="command-input-section">
            <label>启动命令</label>
            <input
              type="text"
              className="command-input"
              value={command}
              onChange={e => setCommand(e.target.value)}
              placeholder="输入命令,如: claude --skip-permissions"
            />
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn-cancel" onClick={onCancel}>取消</button>
          <button className="btn-submit" onClick={handleConfirm}>确认</button>
        </div>
      </div>
    </div>
  );
}
