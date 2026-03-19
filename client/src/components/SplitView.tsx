import { useRef, useEffect, useState, useCallback } from 'react';
import type { Session } from '../services/socket';
import type { SplitState, DropZone, DragState } from '../types/split';
import { addSplit, closeSplitPanel, replaceSession } from '../types/split';
import Terminal from './Terminal';
import FloatingStatus from './FloatingStatus';
import DropOverlay from './DropOverlay';

interface SplitViewProps {
  splitState: SplitState;
  sessions: Session[];
  onSplitStateChange: (state: SplitState) => void;
  dragState: DragState;
  onDragStateChange: (state: DragState) => void;
  pendingTemplateSessionId: string | null;
  promptTemplate?: string;
  onInitialInputSent: () => void;
}

export default function SplitView({
  splitState,
  sessions,
  onSplitStateChange,
  dragState,
  onDragStateChange,
  pendingTemplateSessionId,
  promptTemplate,
  onInitialInputSent,
}: SplitViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const [isDraggingDivider, setIsDraggingDivider] = useState(false);
  // 动画状态
  const [animatingPanel, setAnimatingPanel] = useState<'left' | 'right' | null>(null);
  const [isClosing, setIsClosing] = useState(false);

  // 获取会话对象
  const getSession = (id: string) => sessions.find(s => s.id === id);

  // 处理拖拽放置
  const handleDrop = useCallback((zone: DropZone) => {
    if (!zone || !dragState.sessionId) return;

    const newSessionId = dragState.sessionId;

    if (zone === 'center') {
      // 替换当前焦点面板
      const newState = replaceSession(splitState, splitState.focusedIndex, newSessionId);
      onSplitStateChange(newState);
    } else if (zone === 'left' || zone === 'right') {
      // 创建分屏，带动画
      setAnimatingPanel(zone);
      const newState = addSplit(splitState, newSessionId, zone);

      // 延迟更新状态，让动画有时间播放
      requestAnimationFrame(() => {
        onSplitStateChange(newState);
        setTimeout(() => {
          setAnimatingPanel(null);
          // 动画结束后触发窗口 resize 事件，让终端重新计算尺寸
          window.dispatchEvent(new Event('resize'));
        }, 300);
      });
    }

    // 清除拖拽状态
    onDragStateChange({ isDragging: false, sessionId: null, activeZone: null });
  }, [dragState.sessionId, splitState, onSplitStateChange, onDragStateChange]);

  // 处理关闭面板
  const handleClosePanel = useCallback((index: 0 | 1) => {
    setIsClosing(true);
    setAnimatingPanel(index === 0 ? 'left' : 'right');

    setTimeout(() => {
      const newState = closeSplitPanel(splitState, index);
      onSplitStateChange(newState);
      setIsClosing(false);
      setAnimatingPanel(null);
      // 动画结束后触发窗口 resize 事件
      window.dispatchEvent(new Event('resize'));
    }, 250);
  }, [splitState, onSplitStateChange]);

  // 处理焦点切换
  const handleFocusPanel = useCallback((index: 0 | 1) => {
    if (splitState.focusedIndex !== index) {
      onSplitStateChange({ ...splitState, focusedIndex: index });
    }
  }, [splitState, onSplitStateChange]);

  // 分隔条拖拽
  useEffect(() => {
    if (splitState.mode === 'single') return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingDivider || !containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const newRatio = (e.clientX - rect.left) / rect.width;
      const clampedRatio = Math.max(0.3, Math.min(0.7, newRatio));

      onSplitStateChange({ ...splitState, ratio: clampedRatio });
    };

    const handleMouseUp = () => {
      setIsDraggingDivider(false);
    };

    if (isDraggingDivider) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingDivider, splitState, onSplitStateChange]);

  // 渲染单个面板
  const renderPanel = (sessionId: string, index: 0 | 1, style?: React.CSSProperties) => {
    const session = getSession(sessionId);
    if (!session) return null;

    const isFocused = splitState.focusedIndex === index;
    const isAnimating = animatingPanel === (index === 0 ? 'left' : 'right');

    let panelClass = 'split-panel';
    if (isFocused) panelClass += ' focused';
    if (isAnimating && !isClosing) panelClass += ' animating-in';
    if (isAnimating && isClosing) panelClass += ' animating-out';

    return (
      <div style={{ ...style, position: 'relative', flex: 1, display: 'flex', flexDirection: 'column' }}>
        {splitState.mode !== 'single' && (
          <button
            className="panel-close-btn"
            onClick={(e) => {
              e.stopPropagation();
              handleClosePanel(index);
            }}
          >
            ×
          </button>
        )}
        <FloatingStatus session={session} />
        <div
          className={panelClass}
          onClick={() => handleFocusPanel(index)}
        >
          <Terminal
            key={session.id}
            session={session}
            initialInput={pendingTemplateSessionId === session.id ? promptTemplate : undefined}
            onInitialInputSent={onInitialInputSent}
          />
        </div>
      </div>
    );
  };

  // 单面板模式
  if (splitState.mode === 'single') {
    return (
      <div ref={containerRef} className="split-view single">
        {renderPanel(splitState.sessions[0], 0)}
        <DropOverlay
          isVisible={dragState.isDragging}
          activeZone={dragState.activeZone}
          isSplitMode={false}
          onZoneChange={(zone) => onDragStateChange({ ...dragState, activeZone: zone })}
          onDrop={handleDrop}
        />
      </div>
    );
  }

  // 水平分屏模式
  const [firstId, secondId] = splitState.sessions as [string, string];

  return (
    <div ref={containerRef} className="split-view horizontal">
      {renderPanel(firstId, 0, { width: `${splitState.ratio * 100}%` })}

      <div
        ref={dividerRef}
        className={`split-divider ${isDraggingDivider ? 'dragging' : ''}`}
        onMouseDown={() => setIsDraggingDivider(true)}
      />

      {renderPanel(secondId, 1, { width: `${(1 - splitState.ratio) * 100}%` })}

      <DropOverlay
        isVisible={dragState.isDragging}
        activeZone={dragState.activeZone}
        isSplitMode={true}
        onZoneChange={(zone) => onDragStateChange({ ...dragState, activeZone: zone })}
        onDrop={handleDrop}
      />
    </div>
  );
}
