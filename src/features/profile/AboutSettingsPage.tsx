import { useState } from 'react';
import { ChevronRight, Download } from 'lucide-react';
import { useNavigate } from 'react-router';
import { paths } from '@/shared/config/paths';
import PageHeader from '@/shared/ui/PageHeader';
import { defaultSettings, SETTINGS_KEY } from './settings-model';
import { writeStorage } from '@/shared/lib/storage';
import { localDemoExport } from './local-demo-export';
export default function AboutSettingsPage() {
  const [reset, setReset] = useState(false);
  const navigate = useNavigate();
  const exportData = () => {
    const data = localDemoExport();
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            { app: '共鸣', version: 1, exportedAt: new Date().toISOString(), storage: data },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      ),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `gongming-local-data-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const restore = () => {
    if (!writeStorage('preferences', {}) || !writeStorage(SETTINGS_KEY, defaultSettings)) return;
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    navigate(paths.settings);
  };
  return (
    <div className="settings-page">
      <PageHeader title="关于共鸣" backTo={paths.settings} />
      <div className="settings-content">
        <section className="settings-about-brand">
          <span>共</span>
          <h1>共鸣</h1>
          <p>连接生活，遇见同频的人</p>
          <small>前端体验版 · v1.0.0</small>
        </section>
        <section className="settings-group">
          <h2>应用信息</h2>
          <div className="settings-card">
            <div className="settings-static-row">
              <span>开发方式</span>
              <strong>React · TypeScript · Vite</strong>
            </div>
            <div className="settings-static-row">
              <span>账号与资产</span>
              <strong>本地模拟数据</strong>
            </div>
            <div className="settings-static-row">
              <span>数据保存</span>
              <strong>当前浏览器</strong>
            </div>
          </div>
        </section>
        <section className="settings-group">
          <h2>本地数据</h2>
          <div className="settings-card">
            <button className="settings-nav-row" onClick={exportData}>
              <span className="settings-nav-icon">
                <Download size={20} />
              </span>
              <span className="settings-row-copy">
                <strong>导出我的演示数据</strong>
                <small>下载列入本机演示范围的内容，不包含真实账号隐私或黑名单</small>
              </span>
              <ChevronRight size={18} />
            </button>
            <button className="settings-nav-row" onClick={() => setReset((value) => !value)}>
              <span className="settings-row-copy">
                <strong>恢复默认设置</strong>
                <small>重置偏好与账号设置，保留聊天和资产</small>
              </span>
              <ChevronRight size={18} />
            </button>
          </div>
        </section>
        {reset && (
          <section className="settings-inline-confirm">
            <h2>恢复默认设置？</h2>
            <p>本机偏好与演示安全设置将恢复初始值，不更改真实账号隐私或黑名单。</p>
            <div>
              <button onClick={() => setReset(false)}>取消</button>
              <button className="primary" onClick={restore}>
                确认恢复
              </button>
            </div>
          </section>
        )}
        <p className="settings-hint">
          清理浏览器网站数据会删除本机的演示内容。
          <br />
          应用尚未连接账号服务或真实链上网络。
        </p>
      </div>
    </div>
  );
}
