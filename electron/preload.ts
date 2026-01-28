import { contextBridge } from 'electron';

// 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
});
