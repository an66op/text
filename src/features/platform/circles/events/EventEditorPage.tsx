import { useNavigate, useParams } from 'react-router';
import { PlatformError } from '../../PlatformUi';
import CirclePage from '../CirclePage';
import { useCircle } from '../circle-context';
import { circlePaths } from '../paths';
import { useResource } from '../useResource';
import { Empty } from '../Ui';
import { eventsApi } from './api';
import EventForm from './EventForm';
import './events.css';
export default function EventEditorPage({ creating = false }: { creating?: boolean }) {
  return (
    <CirclePage title={creating ? '创建活动' : '编辑活动'} manager>
      <Editor creating={creating} />
    </CirclePage>
  );
}
function Editor({ creating }: { creating: boolean }) {
  const { circle, deny } = useCircle(),
    { eventId = '' } = useParams(),
    navigate = useNavigate();
  const detail = useResource(
    eventId,
    (signal) => eventsApi.detail(circle.id, eventId, signal),
    deny,
    !creating,
  );
  if (circle.status !== 'active') return <Empty>当前圈子不能创建或修改活动。</Empty>;
  if (!creating && !detail.data)
    return (
      <>
        <PlatformError message={detail.error} retry={detail.refresh} />
        {detail.loading && <Empty>正在确认活动与编辑权限…</Empty>}
      </>
    );
  return (
    <>
      <PlatformError message={detail.error} retry={detail.refresh} />
      <EventForm
        initial={creating ? undefined : detail.data!}
        current={creating ? undefined : detail.data!}
        saved={(value) => navigate(circlePaths.event(circle.id, value.id), { replace: true })}
        reloaded={detail.replace}
      />
    </>
  );
}
