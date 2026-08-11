// 终端链接悬停操作卡：全局单例 DOM（终端实例不在 React 树内，鼠标只有一个）
// 悬停 URL 150ms 后弹出，提供「打开」「复制」两个动作

const SHOW_DELAY = 150;
const HIDE_GRACE = 250;

let el: HTMLDivElement | null = null;
let openBtn: HTMLButtonElement | null = null;
let copyBtn: HTMLButtonElement | null = null;
let currentUrl = '';
let showTimer: number | null = null;
let hideTimer: number | null = null;

function ensureElement(): HTMLDivElement {
  if (el) return el;

  el = document.createElement('div');
  el.className = 'link-popover';

  openBtn = document.createElement('button');
  openBtn.className = 'link-popover-btn';
  openBtn.textContent = '↗ 打开';
  openBtn.addEventListener('click', () => {
    if (currentUrl) window.open(currentUrl, '_blank');
    hideNow();
  });

  copyBtn = document.createElement('button');
  copyBtn.className = 'link-popover-btn';
  copyBtn.textContent = '⧉ 复制';
  copyBtn.addEventListener('click', () => {
    if (!currentUrl || !copyBtn) return;
    navigator.clipboard.writeText(currentUrl).catch(() => {});
    copyBtn.textContent = '✓ 已复制';
    window.setTimeout(hideNow, 600);
  });

  el.appendChild(openBtn);
  el.appendChild(copyBtn);

  // 鼠标进入卡片取消隐藏，离开重新计时
  el.addEventListener('mouseenter', cancelHide);
  el.addEventListener('mouseleave', scheduleHide);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideNow();
  });
  // 点击卡片外任意处收起
  document.addEventListener('mousedown', (e) => {
    if (el && !el.contains(e.target as Node)) hideNow();
  });

  document.body.appendChild(el);
  return el;
}

function cancelShow(): void {
  if (showTimer !== null) {
    clearTimeout(showTimer);
    showTimer = null;
  }
}

function cancelHide(): void {
  if (hideTimer !== null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

// 悬停 150ms 后在鼠标点上方弹出（防止鼠标扫过时闪烁）
export function showSoon(url: string, x: number, y: number): void {
  cancelShow();
  cancelHide();
  showTimer = window.setTimeout(() => {
    showTimer = null;
    const popover = ensureElement();
    currentUrl = url;
    if (copyBtn) copyBtn.textContent = '⧉ 复制';

    popover.classList.add('visible');
    // 先渲染取尺寸，再定位并夹紧到视口内
    const rect = popover.getBoundingClientRect();
    const left = Math.min(Math.max(x - rect.width / 2, 8), window.innerWidth - rect.width - 8);
    let top = y - rect.height - 10;
    if (top < 8) top = y + 16; // 贴近视口顶部时翻转到鼠标下方
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  }, SHOW_DELAY);
}

// 鼠标离开链接：宽限期内允许移动到卡片上
export function scheduleHide(): void {
  cancelShow();
  cancelHide();
  hideTimer = window.setTimeout(hideNow, HIDE_GRACE);
}

export function hideNow(): void {
  cancelShow();
  cancelHide();
  currentUrl = '';
  el?.classList.remove('visible');
}

export const linkPopover = { showSoon, scheduleHide, hideNow };
