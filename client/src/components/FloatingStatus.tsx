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
  return (
    <>
      <div className={`floating-status floating-${session.status}`}>
        <span className="floating-icon">{getStatusIcon(session.status)}</span>
        <span className="floating-text">{getStatusText(session.status)}</span>
      </div>
      {session.currentTask && session.status === 'busy' && (
        <div className="floating-task">
          {session.currentTask}
        </div>
      )}
    </>
  );
}
