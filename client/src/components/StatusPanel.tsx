import type { Session } from '../services/socket';

interface StatusPanelProps {
  session: Session;
}

export default function StatusPanel({ session }: StatusPanelProps) {
  return (
    <div className="status-panel">
      <div className="status-section">
        <div className="status-header">
          <span className="status-label">对话概括</span>
        </div>
        <div className="status-content summary">
          {session.summary || '使用左侧批量刷新按钮生成摘要'}
        </div>
      </div>
    </div>
  );
}
