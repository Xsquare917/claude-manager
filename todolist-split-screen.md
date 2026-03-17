# 分屏功能设计文档

## 功能概述

实现类似手机/iPad 的分屏交互体验，支持从左侧 Sidebar 拖拽会话到主区域进行分屏显示。

## 交互设计

### 1. 拖拽分屏

从 Sidebar 拖拽会话到主区域，根据放置位置决定分屏方向：

```
┌─────────────────────────────────────┐
│              上 (20%)               │  ← 上下分屏，新会话在上
├─────────┬───────────────┬───────────┤
│         │               │           │
│ 左(20%) │   中心(60%)   │ 右(20%)   │  ← 中心 = 替换当前会话
│         │               │           │
├─────────┴───────────────┴───────────┤
│              下 (20%)               │  ← 上下分屏，新会话在下
└─────────────────────────────────────┘
```

### 2. Focus 高亮

当前聚焦的面板显示蓝色边框高亮：

```
╔═══════════════════════════════════╗
║                                   ║
║   Terminal (focused)              ║  ← 蓝色边框 + 光晕
║                                   ║
╚═══════════════════════════════════╝
```

### 3. 目录名称 Toast

切换 Focus 时从上方弹入目录名称提示：

```
┌─────────────────────────────────────┐
│    ┌─────────────────────────┐      │
│    │  📁 claude-manager      │ ←─── 从上方滑入，停留后滑出
│    └─────────────────────────┘      │
│                                     │
└─────────────────────────────────────┘
```

### 4. 关闭分屏

点击面板右上角 × 关闭该面板，剩余面板自动填满空间。

---

## 数据结构

### 布局树

```typescript
// 面板节点
interface PanelNode {
  type: 'panel';
  sessionId: string;
}

// 分割节点
interface SplitNode {
  type: 'split';
  direction: 'horizontal' | 'vertical';
  ratio: number; // 0-1，第一个子节点占比
  children: [LayoutNode, LayoutNode];
}

// 布局节点（联合类型）
type LayoutNode = PanelNode | SplitNode;
```

### 示例

单面板：
```json
{ "type": "panel", "sessionId": "abc123" }
```

左右分屏：
```json
{
  "type": "split",
  "direction": "horizontal",
  "ratio": 0.5,
  "children": [
    { "type": "panel", "sessionId": "abc123" },
    { "type": "panel", "sessionId": "def456" }
  ]
}
```

嵌套分屏（左 + 右上右下）：
```json
{
  "type": "split",
  "direction": "horizontal",
  "ratio": 0.5,
  "children": [
    { "type": "panel", "sessionId": "abc123" },
    {
      "type": "split",
      "direction": "vertical",
      "ratio": 0.5,
      "children": [
        { "type": "panel", "sessionId": "def456" },
        { "type": "panel", "sessionId": "ghi789" }
      ]
    }
  ]
}
```

---

## 状态管理

```typescript
// App 层新增状态
const [layout, setLayout] = useState<LayoutNode | null>(null);
const [focusedPanelId, setFocusedPanelId] = useState<string | null>(null);
```

---

## 组件结构

| 组件 | 职责 |
|------|------|
| `SplitLayout.tsx` | 递归渲染分屏布局树 |
| `SplitPanel.tsx` | 单个面板容器（含关闭按钮、Focus 状态） |
| `DropZone.tsx` | 拖拽放置区域预览（上/下/左/右/中心） |
| `PanelToast.tsx` | 目录名称 Toast 动画组件 |
| `SplitDivider.tsx` | 可拖拽的分隔条 |

---

## 动画设计

### 1. 拖拽预览区域动画

**触发时机**: 从 Sidebar 拖拽会话进入主区域

```
进入时：
┌─────────────────────┐
│                     │  opacity: 0 → 1
│   ┌─────────────┐   │  scale: 0.95 → 1
│   │  放置到上方  │   │  duration: 150ms
│   └─────────────┘   │  easing: ease-out
│                     │
└─────────────────────┘

悬停在某区域时：
- 该区域背景色加深 (opacity 0.1 → 0.3)
- 轻微放大 scale: 1 → 1.02
- duration: 100ms

离开时：
- 反向动画
- duration: 100ms
```

### 2. 分屏创建动画

**触发时机**: 松开拖拽，确认分屏

```
左右分屏示例（新面板从右侧滑入）：

Before:                    After:
┌───────────────────┐      ┌─────────┬─────────┐
│                   │  →   │         │ ←────── │ 新面板从右侧滑入
│     Panel A       │      │ Panel A │ Panel B │ translateX: 100% → 0
│                   │      │         │         │
└───────────────────┘      └─────────┴─────────┘

动画参数：
- 原面板: width 100% → 50%, duration: 300ms
- 新面板: translateX: 100% → 0, opacity: 0 → 1
- easing: cubic-bezier(0.4, 0, 0.2, 1)
- 分隔条: opacity: 0 → 1, 延迟 150ms 出现

上下分屏：同理，新面板从对应方向滑入
```

### 3. 分屏关闭动画

**触发时机**: 点击面板关闭按钮

```
关闭右侧面板示例：

Before:                    After:
┌─────────┬─────────┐      ┌───────────────────┐
│         │    ×    │  →   │                   │
│ Panel A │ Panel B │      │     Panel A       │
│         │ ──────→ │      │                   │
└─────────┴─────────┘      └───────────────────┘

动画参数：
- 被关闭面板: translateX: 0 → 100%, opacity: 1 → 0
- 剩余面板: width 50% → 100%
- duration: 250ms
- easing: cubic-bezier(0.4, 0, 1, 1)
```

### 4. Focus 切换动画

**触发时机**: 点击不同面板

```
┌─────────────────────────────┐
│  ╔═══════════════════════╗  │  获得焦点:
│  ║                       ║  │  - border-color: transparent → #4a9eff
│  ║   Focused Panel       ║  │  - box-shadow: 0 → 0 0 0 2px rgba(74,158,255,0.3)
│  ║                       ║  │  - duration: 200ms
│  ╚═══════════════════════╝  │  - easing: ease-out
│                             │
│  ┌───────────────────────┐  │  失去焦点:
│  │   Unfocused Panel     │  │  - 反向动画
│  └───────────────────────┘  │  - duration: 150ms
└─────────────────────────────┘
```

### 5. Toast 目录名称动画

**触发时机**: Focus 切换到新面板

```
时间轴:

0ms        200ms       2000ms      2200ms
 │          │            │           │
 ▼          ▼            ▼           ▼
[滑入开始] [滑入完成]  [开始滑出]  [完全消失]

滑入动画:
┌─────────────────────────────┐
│     ↓ translateY: -100% → 0 │
│  ┌─────────────────────┐    │
│  │ 📁 claude-manager   │    │  - opacity: 0 → 1
│  └─────────────────────┘    │  - translateY: -20px → 0
│                             │  - duration: 200ms
│                             │  - easing: cubic-bezier(0.34, 1.56, 0.64, 1)
└─────────────────────────────┘

停留: 1800ms

滑出动画:
- opacity: 1 → 0
- translateY: 0 → -10px
- duration: 200ms
- easing: ease-in

连续切换处理:
- 如果在 Toast 显示期间再次切换 focus
- 立即更新文字内容（crossfade 150ms）
- 重置停留计时器
```

### 6. 分隔条拖拽动画

**触发时机**: 拖拽分隔条调整比例

```
悬停状态:
───────────────────
        │
        │ ← 分隔条宽度: 4px → 6px
        │   背景色: #333 → #4a9eff
        │   cursor: col-resize
───────────────────

拖拽中:
- 分隔条保持高亮
- 两侧面板实时调整大小（无动画，即时响应）

释放时:
- 分隔条恢复默认宽度
- duration: 150ms
```

### 7. 拖拽会话项的视觉反馈

**触发时机**: 开始拖拽 Sidebar 中的会话

```
拖拽开始:
┌──────────────────┐
│ 📁 Session Name  │  - scale: 1 → 0.95
│                  │  - opacity: 1 → 0.5
└──────────────────┘  - duration: 150ms

拖拽中的幽灵元素:
┌──────────────────┐
│ 📁 Session Name  │  - 跟随鼠标
│                  │  - opacity: 0.8
└──────────────────┘  - box-shadow 增强
                      - transform: rotate(3deg)

拖拽结束/取消:
- 原位置元素恢复: scale, opacity
- duration: 200ms
```

---

## 动画参数汇总

| 动画类型 | Duration | Easing | 备注 |
|---------|----------|--------|------|
| 预览区域显示 | 150ms | ease-out | 快速响应 |
| 分屏创建 | 300ms | cubic-bezier(0.4, 0, 0.2, 1) | 平滑自然 |
| 分屏关闭 | 250ms | cubic-bezier(0.4, 0, 1, 1) | 加速离开 |
| Focus 高亮 | 200ms | ease-out | 柔和过渡 |
| Toast 滑入 | 200ms | cubic-bezier(0.34, 1.56, 0.64, 1) | 弹性活泼 |
| Toast 滑出 | 200ms | ease-in | 自然消失 |
| 分隔条悬停 | 150ms | ease-out | 即时反馈 |
| 拖拽反馈 | 150ms | ease-out | 即时反馈 |

---

## 技术选型

| 功能 | 方案 |
|------|------|
| 拖拽 | HTML5 Drag and Drop API |
| 分屏渲染 | 递归组件 + CSS Flexbox |
| 分隔条拖拽 | 原生实现（mousedown/mousemove/mouseup） |
| 动画 | CSS Transitions + Keyframes |

---

## 文件清单

### 新增组件
- `client/src/components/SplitLayout.tsx` - 分屏布局容器
- `client/src/components/SplitPanel.tsx` - 单个面板
- `client/src/components/DropZone.tsx` - 拖拽放置区域
- `client/src/components/PanelToast.tsx` - 目录名称 Toast
- `client/src/components/SplitDivider.tsx` - 分隔条

### 修改文件
- `client/src/App.tsx` - 添加 layout 状态管理
- `client/src/App.css` - 添加分屏相关样式
- `client/src/components/Sidebar.tsx` - 添加拖拽支持
