import type { UpdateInfo } from '../services/versionCheck';
import { getReleasesUrl, markVersionShown, clearPendingUpdate } from '../services/versionCheck';

interface UpdateModalProps {
  updateInfo: UpdateInfo;
  onClose: () => void;
}

export default function UpdateModal({ updateInfo, onClose }: UpdateModalProps) {
  const handleDownload = () => {
    window.open(getReleasesUrl(), '_blank');
    handleClose();
  };

  const handleClose = () => {
    markVersionShown(updateInfo.latestVersion);
    clearPendingUpdate();
    onClose();
  };

  // 格式化发布日期
  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal update-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🎉 发现新版本</h2>
          <button className="btn-close" onClick={handleClose}>×</button>
        </div>

        <div className="update-content">
          <div className="version-info">
            <div className="version-badge">
              <span className="version-label">当前版本</span>
              <span className="version-number">v{updateInfo.currentVersion}</span>
            </div>
            <span className="version-arrow">→</span>
            <div className="version-badge new">
              <span className="version-label">最新版本</span>
              <span className="version-number">v{updateInfo.latestVersion}</span>
            </div>
          </div>

          <div className="release-date">
            发布于 {formatDate(updateInfo.publishedAt)}
          </div>

          <div className="release-notes">
            <h3>更新内容</h3>
            <div className="notes-content">
              {updateInfo.releaseNotes}
            </div>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn-cancel" onClick={handleClose}>稍后提醒</button>
          <button className="btn-submit" onClick={handleDownload}>前往下载</button>
        </div>
      </div>
    </div>
  );
}
