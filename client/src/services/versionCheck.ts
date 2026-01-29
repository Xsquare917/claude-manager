// GitHub 仓库信息
const GITHUB_REPO = 'Xsquare917/claude-manager';
const CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24小时

export interface UpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseNotes: string;
  downloadUrl: string;
  publishedAt: string;
}

// 版本号比较 (简单实现，支持 x.y.z 格式)
function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

// 获取当前版本
export function getCurrentVersion(): string {
  return __APP_VERSION__ || '1.0.0';
}

// 检查更新
export async function checkForUpdates(): Promise<UpdateInfo | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      { headers: { 'Accept': 'application/vnd.github.v3+json' } }
    );

    if (!response.ok) {
      console.error('Failed to fetch release info:', response.status);
      return null;
    }

    const data = await response.json();
    const latestVersion = data.tag_name.replace(/^v/, '');
    const currentVersion = getCurrentVersion();

    return {
      hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
      currentVersion,
      latestVersion,
      releaseNotes: data.body || '暂无更新说明',
      downloadUrl: data.html_url,
      publishedAt: data.published_at,
    };
  } catch (error) {
    console.error('Version check failed:', error);
    return null;
  }
}

// 获取上次检查时间
function getLastCheckTime(): number {
  const saved = localStorage.getItem('cm-last-version-check');
  return saved ? parseInt(saved, 10) : 0;
}

// 保存检查时间
function setLastCheckTime(time: number) {
  localStorage.setItem('cm-last-version-check', time.toString());
}

// 获取已显示过的版本（避免重复弹窗）
function getShownVersion(): string | null {
  return localStorage.getItem('cm-shown-update-version');
}

// 标记版本已显示
export function markVersionShown(version: string) {
  localStorage.setItem('cm-shown-update-version', version);
}

// 获取待显示的更新信息
export function getPendingUpdate(): UpdateInfo | null {
  const saved = localStorage.getItem('cm-pending-update');
  if (!saved) return null;

  try {
    const info = JSON.parse(saved) as UpdateInfo;
    // 检查是否已经显示过这个版本
    if (getShownVersion() === info.latestVersion) {
      return null;
    }
    return info;
  } catch {
    return null;
  }
}

// 保存待显示的更新信息
function savePendingUpdate(info: UpdateInfo) {
  localStorage.setItem('cm-pending-update', JSON.stringify(info));
}

// 清除待显示的更新信息
export function clearPendingUpdate() {
  localStorage.removeItem('cm-pending-update');
}

// 定时检查更新（每24小时）
export async function scheduleUpdateCheck(): Promise<UpdateInfo | null> {
  const now = Date.now();
  const lastCheck = getLastCheckTime();

  // 如果距离上次检查不足24小时，跳过
  if (now - lastCheck < CHECK_INTERVAL) {
    return null;
  }

  setLastCheckTime(now);
  const info = await checkForUpdates();

  if (info?.hasUpdate) {
    savePendingUpdate(info);
  }

  return info;
}

// 获取 releases 页面 URL
export function getReleasesUrl(): string {
  return `https://github.com/${GITHUB_REPO}/releases`;
}
