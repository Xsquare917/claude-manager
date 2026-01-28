import { useState } from 'react';

interface AddProjectModalProps {
  onClose: () => void;
  onAdd: (path: string) => void;
}

export default function AddProjectModal({ onClose, onAdd }: AddProjectModalProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handlePickFolder = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/pick-folder');
      const data = await res.json();
      if (data.path) {
        setSelectedPath(data.path);
      }
    } catch (error) {
      console.error('Failed to pick folder:', error);
    }
    setLoading(false);
  };

  const handleSubmit = () => {
    if (selectedPath) {
      onAdd(selectedPath);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>添加项目</h2>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>

        <div className="picker-content">
          <button
            className="btn-pick"
            onClick={handlePickFolder}
            disabled={loading}
          >
            {loading ? '选择中...' : '选择项目目录'}
          </button>

          {selectedPath && (
            <div className="selected-path">
              <span className="path-label">已选择:</span>
              <span className="path-value">{selectedPath}</span>
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn-cancel" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn-submit"
            onClick={handleSubmit}
            disabled={!selectedPath}
          >
            添加
          </button>
        </div>
      </div>
    </div>
  );
}
