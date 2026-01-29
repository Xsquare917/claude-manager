import { useState, useEffect, useRef } from 'react';
import type { Session } from '../services/socket';

interface FloatingStatusProps {
  session: Session;
}

function getStatusIcon(status: Session['status']) {
  switch (status) {
    case 'busy': return '🔄';
    case 'waiting': return '💬';
    default: return '✅';
  }
}

function getStatusText(status: Session['status']) {
  switch (status) {
    case 'busy': return '忙碌中';
    case 'waiting': return '等待输入';
    default: return '空闲';
  }
}

export default function FloatingStatus({ session }: FloatingStatusProps) {
  const [visible, setVisible] = useState(false);
  const [displayStatus, setDisplayStatus] = useState(session.status);
  const timerRef = useRef<number | null>(null);
  const prevStatusRef = useRef(session.status);

  useEffect(() => {
    // 清除之前的定时器
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // 状态变化时
    if (prevStatusRef.current !== session.status) {
      // 先弹出旧状态
      setVisible(false);

      // 短暂延迟后弹入新状态
      setTimeout(() => {
        setDisplayStatus(session.status);
        setVisible(true);

        // 3秒后弹出
        timerRef.current = window.setTimeout(() => {
          setVisible(false);
        }, 3000);
      }, 300);
    } else {
      // 初始显示
      setDisplayStatus(session.status);
      setVisible(true);

      timerRef.current = window.setTimeout(() => {
        setVisible(false);
      }, 3000);
    }

    prevStatusRef.current = session.status;

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [session.status]);

  return (
    <>
      <div className={`floating-status floating-${displayStatus} ${visible ? 'visible' : ''}`}>
        <span className="floating-icon">{getStatusIcon(displayStatus)}</span>
        <span className="floating-text">{getStatusText(displayStatus)}</span>
      </div>
      {session.currentTask && session.status === 'busy' && (
        <div className="floating-task">
          {session.currentTask}
        </div>
      )}
    </>
  );
}
