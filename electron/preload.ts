import { contextBridge, ipcRenderer } from 'electron';

// 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
  downloadAndInstall: (url: string) => ipcRenderer.invoke('download-and-install', url),
  onDownloadProgress: (callback: (progress: number) => void) => {
    ipcRenderer.on('download-progress', (_event, progress) => callback(progress));
  },
});
