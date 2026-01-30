import { useState, useRef } from 'react';

interface SetupGuideProps {
  onComplete: (buttonX: number, buttonY: number) => void;
  isExiting?: boolean;
}

interface CheckStatus {
  node: { installed: boolean; version: string | null; checking: boolean };
  cli: { installed: boolean; version: string | null; checking: boolean };
}

export default function SetupGuide({ onComplete, isExiting = false }: SetupGuideProps) {
  const [status, setStatus] = useState<CheckStatus>({
    node: { installed: false, version: null, checking: true },
    cli: { installed: false, version: null, checking: true },
  });
  const [copied, setCopied] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleStart = (e: React.MouseEvent<HTMLButtonElement>) => {
    // 获取按钮位置，计算相对于窗口的百分比位置
    const button = e.currentTarget;
    const buttonRect = button.getBoundingClientRect();
    const x = ((buttonRect.left + buttonRect.width / 2) / window.innerWidth) * 100;
    const y = ((buttonRect.top + buttonRect.height / 2) / window.innerHeight) * 100;

    localStorage.setItem('cm-setup-version', '1.2.1');
    onComplete(x, y);
  };

  const checkStatus = async () => {
    setStatus(prev => ({
      node: { ...prev.node, checking: true },
      cli: { ...prev.cli, checking: true },
    }));

    try {
      const [nodeRes, cliRes] = await Promise.all([
        fetch('/api/check-node').then(r => r.json()),
        fetch('/api/check-cli').then(r => r.json()),
      ]);

      const newStatus = {
        node: { ...nodeRes, checking: false },
        cli: { ...cliRes, checking: false },
      };
      setStatus(newStatus);
    } catch {
      setStatus({
        node: { installed: false, version: null, checking: false },
        cli: { installed: false, version: null, checking: false },
      });
    }
  };

  useState(() => {
    checkStatus();
  });

  const copyCommand = (cmd: string, id: string) => {
    navigator.clipboard.writeText(cmd);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const allReady = status.node.installed && status.cli.installed;

  return (
    <div className={`setup-guide ${isExiting ? 'exiting' : ''}`} ref={containerRef}>
      <div className="setup-container">
        <h1>欢迎使用 Claude Manager</h1>
        <p className="setup-subtitle">多项目 Claude Code 会话管理器</p>

        <div className="setup-steps">
          <div className={`setup-step ${status.node.installed ? 'completed' : ''}`}>
            <div className="step-header">
              <span className="step-number">1</span>
              <span className="step-title">安装 Node.js</span>
              <span className={`step-status ${status.node.checking ? 'checking' : ''}`}>
                {status.node.checking ? '检测中...' :
                 status.node.installed ? `已安装 ${status.node.version}` : '未安装'}
              </span>
            </div>
            {!status.node.installed && !status.node.checking && (
              <div className="step-content">
                <p>请访问 Node.js 官网下载安装：</p>
                <a
                  href="https://nodejs.org/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-link"
                >
                  https://nodejs.org/
                </a>
              </div>
            )}
          </div>

          <div className={`setup-step ${status.cli.installed ? 'completed' : ''}`}>
            <div className="step-header">
              <span className="step-number">2</span>
              <span className="step-title">安装 Claude CLI</span>
              <span className={`step-status ${status.cli.checking ? 'checking' : ''}`}>
                {status.cli.checking ? '检测中...' :
                 status.cli.installed ? `已安装 ${status.cli.version}` : '未安装'}
              </span>
            </div>
            {!status.cli.installed && !status.cli.checking && status.node.installed && (
              <div className="step-content">
                <p>打开终端，运行以下命令：</p>
                <div className="command-box">
                  <code>npm install -g @anthropic-ai/claude-code</code>
                  <button
                    className="btn-copy"
                    onClick={() => copyCommand('npm install -g @anthropic-ai/claude-code', 'install')}
                  >
                    {copied === 'install' ? '已复制' : '复制'}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className={`setup-step ${allReady ? 'completed' : ''}`}>
            <div className="step-header">
              <span className="step-number">3</span>
              <span className="step-title">登录 Claude 账号</span>
              <span className="step-status">
                {allReady ? '准备就绪' : '等待前置步骤'}
              </span>
            </div>
            {allReady && (
              <div className="step-content">
                <p>首次使用需要登录，在终端运行：</p>
                <div className="command-box">
                  <code>claude</code>
                  <button
                    className="btn-copy"
                    onClick={() => copyCommand('claude', 'login')}
                  >
                    {copied === 'login' ? '已复制' : '复制'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="setup-actions">
          <button className="btn-check" onClick={checkStatus}>
            重新检测
          </button>
          {allReady && (
            <button className="btn-start" onClick={handleStart}>
              开始使用
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
