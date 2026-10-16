import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { paths } from '@/shared/config/paths';
import PageHeader from '@/shared/ui/PageHeader';
import { useAccountSettings } from './useAccountSettings';
import SettingsSwitch from './SettingsSwitch';
export default function PrivacySettingsPage() {
  const { settings, update } = useAccountSettings();
  const change = <K extends keyof typeof settings.privacy>(
    key: K,
    value: (typeof settings.privacy)[K],
  ) => update((current) => ({ ...current, privacy: { ...current.privacy, [key]: value } }));
  return (
    <div className="settings-page">
      <PageHeader title="隐私权限" backTo={paths.settings} />
      <div className="settings-content">
        <section className="settings-group">
          <h2>动态与好友</h2>
          <div className="settings-card">
            <label className="settings-row">
              <span className="settings-row-copy">
                <strong>默认动态可见范围</strong>
                <small>发布动态时的默认范围</small>
              </span>
              <select
                aria-label="默认动态可见范围"
                value={settings.privacy.visibility}
                onChange={(event) =>
                  change('visibility', event.target.value as typeof settings.privacy.visibility)
                }
              >
                <option>公开</option>
                <option>仅好友</option>
                <option>仅自己</option>
              </select>
            </label>
            <SettingsSwitch
              label="通过共鸣号找到我"
              description="账号搜索权限偏好，保存在本机"
              checked={settings.privacy.findByHandle}
              onChange={(checked) => change('findByHandle', checked)}
            />
            <SettingsSwitch
              label="添加好友需要验证"
              description="新朋友验证偏好，保存在本机"
              checked={settings.privacy.friendRequest}
              onChange={(checked) => change('friendRequest', checked)}
            />
            <SettingsSwitch
              label="显示已读状态"
              description="已读状态偏好，保存在本机"
              checked={settings.privacy.readReceipts}
              onChange={(checked) => change('readReceipts', checked)}
            />
          </div>
        </section>
        <section className="settings-group">
          <h2>联系人管理</h2>
          <div className="settings-card">
            <Link className="settings-nav-row" to="/settings/blocked">
              <span className="settings-row-copy">
                <strong>黑名单</strong>
                <small>管理屏蔽的联系人</small>
              </span>
              <ChevronRight size={18} />
            </Link>
          </div>
        </section>
        <p className="settings-hint">隐私选项用于本地演示账号，不涉及真实平台授权</p>
      </div>
    </div>
  );
}
