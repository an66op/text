import { paths } from '@/shared/config/paths';
import PageHeader from '@/shared/ui/PageHeader';
import { usePreferences } from './preferences';
import { useAccountSettings } from './useAccountSettings';
import SettingsSwitch from './SettingsSwitch';
export default function NotificationSettingsPage() {
  const { settings, update } = useAccountSettings();
  const [preferences, setPreferences] = usePreferences();
  const enabled = preferences['消息通知'] ?? true;
  const change = <K extends keyof typeof settings.notifications>(
    key: K,
    value: (typeof settings.notifications)[K],
  ) =>
    update((current) => ({
      ...current,
      notifications: { ...current.notifications, [key]: value },
    }));
  return (
    <div className="settings-page">
      <PageHeader title="消息通知" backTo={paths.settings} />
      <div className="settings-content">
        <section className="settings-group">
          <h2>消息提醒</h2>
          <div className="settings-card">
            <SettingsSwitch
              label="消息通知"
              description="好友与互动消息的本地提醒"
              checked={enabled}
              onChange={(checked) =>
                setPreferences((current) => ({ ...current, 消息通知: checked }))
              }
            />
            <SettingsSwitch
              label="提示音"
              description="接收新消息时的提示音偏好"
              checked={settings.notifications.sound}
              onChange={(checked) => change('sound', checked)}
              disabled={!enabled}
            />
            <SettingsSwitch
              label="振动提醒"
              description="保存振动偏好，演示不调用设备振动"
              checked={settings.notifications.vibration}
              onChange={(checked) => change('vibration', checked)}
              disabled={!enabled}
            />
            <SettingsSwitch
              label="显示消息预览"
              description="会话列表显示消息摘要"
              checked={settings.notifications.showPreview}
              onChange={(checked) => change('showPreview', checked)}
            />
          </div>
        </section>
        <section className="settings-group">
          <h2>免打扰</h2>
          <div className="settings-card">
            <SettingsSwitch
              label="定时免打扰"
              description="保存本机免打扰时段"
              checked={settings.notifications.quiet}
              onChange={(checked) => change('quiet', checked)}
            />
            <label className="settings-static-row">
              <span>开始时间</span>
              <input
                aria-label="免打扰开始时间"
                type="time"
                value={settings.notifications.quietStart}
                disabled={!settings.notifications.quiet}
                onChange={(event) => change('quietStart', event.target.value)}
              />
            </label>
            <label className="settings-static-row">
              <span>结束时间</span>
              <input
                aria-label="免打扰结束时间"
                type="time"
                value={settings.notifications.quietEnd}
                disabled={!settings.notifications.quiet}
                onChange={(event) => change('quietEnd', event.target.value)}
              />
            </label>
          </div>
        </section>
        <p className="settings-hint">设置自动保存；不会申请系统通知权限</p>
      </div>
    </div>
  );
}
