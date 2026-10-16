import { paths } from '@/shared/config/paths';
import PageHeader from '@/shared/ui/PageHeader';
import { usePreferences } from './preferences';
import SettingsSwitch from './SettingsSwitch';
export default function ContentSettingsPage() {
  const [preferences, setPreferences] = usePreferences();
  const options = [
    { label: '旅行与户外', description: '发现远方，也探索身边的风景' },
    { label: '摄影与艺术', description: '关注影像、创作与生活灵感' },
    { label: '阅读与写作', description: '遇见好书和喜欢的文字' },
  ];
  return (
    <div className="settings-page">
      <PageHeader title="内容偏好" backTo={paths.settings} />
      <div className="settings-content">
        <section className="settings-group">
          <h2>影音播放</h2>
          <div className="settings-card">
            <SettingsSwitch
              label="自动播放预览"
              description="影音预览会遵循此设置；浏览器可能要求点击播放"
              checked={preferences['自动播放预览'] ?? true}
              onChange={(checked) =>
                setPreferences((current) => ({ ...current, 自动播放预览: checked }))
              }
            />
          </div>
        </section>
        <section className="settings-group">
          <h2>感兴趣的内容</h2>
          <div className="settings-card">
            {options.map(({ label, description }) => (
              <SettingsSwitch
                key={label}
                label={label}
                description={description}
                checked={preferences[label] ?? true}
                onChange={(checked) =>
                  setPreferences((current) => ({ ...current, [label]: checked }))
                }
              />
            ))}
          </div>
        </section>
        <p className="settings-hint">兴趣偏好与播放选项自动保存在本机</p>
      </div>
    </div>
  );
}
