// 分屏布局类型定义

export type SplitMode = 'single' | 'horizontal' | 'vertical';

export interface SplitState {
  mode: SplitMode;
  sessions: [string] | [string, string];  // 最多2个会话ID
  focusedIndex: 0 | 1;
  ratio: number;  // 0.3 - 0.7，第一个面板占比
}

// 拖拽放置区域
export type DropZone = 'left' | 'right' | 'center' | null;

// 拖拽状态
export interface DragState {
  isDragging: boolean;
  sessionId: string | null;
  activeZone: DropZone;
}

// 创建默认分屏状态
export function createSplitState(sessionId: string): SplitState {
  return {
    mode: 'single',
    sessions: [sessionId],
    focusedIndex: 0,
    ratio: 0.5,
  };
}

// 添加分屏
export function addSplit(
  state: SplitState,
  newSessionId: string,
  zone: 'left' | 'right'
): SplitState {
  const currentSessionId = state.sessions[state.focusedIndex]!;

  if (zone === 'left') {
    return {
      mode: 'horizontal',
      sessions: [newSessionId, currentSessionId],
      focusedIndex: 0,
      ratio: 0.5,
    };
  } else {
    return {
      mode: 'horizontal',
      sessions: [currentSessionId, newSessionId],
      focusedIndex: 1,
      ratio: 0.5,
    };
  }
}

// 关闭分屏中的一个面板
export function closeSplitPanel(state: SplitState, index: 0 | 1): SplitState {
  if (state.mode === 'single') return state;

  const remainingIndex = index === 0 ? 1 : 0;
  const remainingSessionId = state.sessions[remainingIndex]!;

  return {
    mode: 'single',
    sessions: [remainingSessionId],
    focusedIndex: 0,
    ratio: 0.5,
  };
}

// 替换指定面板的会话
export function replaceSession(
  state: SplitState,
  index: 0 | 1,
  newSessionId: string
): SplitState {
  if (state.mode === 'single') {
    return {
      ...state,
      sessions: [newSessionId],
    };
  }

  const newSessions: [string, string] = [...state.sessions] as [string, string];
  newSessions[index] = newSessionId;

  return {
    ...state,
    sessions: newSessions,
    focusedIndex: index,
  };
}
