import { useEffect, useState } from 'react';
import type { DropZone } from '../types/split';

interface DropOverlayProps {
  isVisible: boolean;
  activeZone: DropZone;
  isSplitMode: boolean;  // 当前是否已经是分屏模式
  onZoneChange: (zone: DropZone) => void;
  onDrop: (zone: DropZone) => void;
}

export default function DropOverlay({
  isVisible,
  activeZone,
  isSplitMode,
  onZoneChange,
  onDrop,
}: DropOverlayProps) {
  const [isAnimatingIn, setIsAnimatingIn] = useState(false);

  useEffect(() => {
    if (isVisible) {
      requestAnimationFrame(() => setIsAnimatingIn(true));
    } else {
      setIsAnimatingIn(false);
    }
  }, [isVisible]);

  if (!isVisible) return null;

  const handleDragOver = (e: React.DragEvent, zone: DropZone) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    onZoneChange(zone);
  };

  const handleDrop = (e: React.DragEvent, zone: DropZone) => {
    e.preventDefault();
    onDrop(zone);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // 只有离开整个 overlay 时才清除
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      onZoneChange(null);
    }
  };

  // 分屏模式下只显示中心区域（替换当前面板）
  if (isSplitMode) {
    return (
      <div className={`drop-overlay ${isAnimatingIn ? 'visible' : ''}`}>
        <div
          className={`drop-zone center-only ${activeZone === 'center' ? 'active' : ''}`}
          onDragOver={(e) => handleDragOver(e, 'center')}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, 'center')}
        >
          <div className="drop-zone-content">
            <span className="drop-zone-icon">↻</span>
            <span className="drop-zone-label">替换当前面板</span>
          </div>
        </div>
      </div>
    );
  }

  // 单面板模式：显示左/中/右三个区域
  return (
    <div className={`drop-overlay ${isAnimatingIn ? 'visible' : ''}`}>
      <div
        className={`drop-zone left ${activeZone === 'left' ? 'active' : ''}`}
        onDragOver={(e) => handleDragOver(e, 'left')}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, 'left')}
      >
        <div className="drop-zone-content">
          <span className="drop-zone-icon">◧</span>
          <span className="drop-zone-label">左侧分屏</span>
        </div>
      </div>

      <div
        className={`drop-zone center ${activeZone === 'center' ? 'active' : ''}`}
        onDragOver={(e) => handleDragOver(e, 'center')}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, 'center')}
      >
        <div className="drop-zone-content">
          <span className="drop-zone-icon">↻</span>
          <span className="drop-zone-label">替换当前</span>
        </div>
      </div>

      <div
        className={`drop-zone right ${activeZone === 'right' ? 'active' : ''}`}
        onDragOver={(e) => handleDragOver(e, 'right')}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, 'right')}
      >
        <div className="drop-zone-content">
          <span className="drop-zone-icon">◨</span>
          <span className="drop-zone-label">右侧分屏</span>
        </div>
      </div>
    </div>
  );
}
