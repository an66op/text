import { Link, useParams } from 'react-router';
import { PlatformError } from '../PlatformUi';
import CirclePage from './CirclePage';
import { circlesApi } from './api';
import { useCircle } from './circle-context';
import { circlePaths } from './paths';
import { isManager } from './types';
import { useResource } from './useResource';
import Feed from './Feed';
import { Empty } from './Ui';
export default function ChannelPage() {
  return (
    <CirclePage title="频道">
      <ChannelContent />
    </CirclePage>
  );
}
function ChannelContent() {
  const { circle, deny } = useCircle();
  const { channelId = '' } = useParams();
  const channels = useResource(circle.id, (signal) => circlesApi.channels(circle.id, signal), deny);
  const channel = channels.data?.items.find((item) => item.id === channelId);
  return (
    <>
      <PlatformError message={channels.error} retry={channels.refresh} />
      {channels.loading ? (
        <Empty>正在读取频道…</Empty>
      ) : !channel ? (
        <Empty>频道不存在或当前不可访问。</Empty>
      ) : (
        <>
          <div className="sc-channel-heading">
            <span>{channel.kind === 'forum' ? '讨论频道' : '公告频道'}</span>
            <h1>{channel.name}</h1>
            <p>{channel.description}</p>
            {channel.archived ? (
              <p className="sc-notice">频道已归档，只能阅读历史。</p>
            ) : circle.status === 'active' && (channel.kind === 'forum' || isManager(circle)) ? (
              <Link className="sc-primary" to={circlePaths.compose(circle.id, channel.id)}>
                发表帖子
              </Link>
            ) : (
              <p className="sc-muted">公告主帖由圈方发布，成员可以点赞和评论。</p>
            )}
          </div>
          <Feed key={channel.id} channel={channel} />
        </>
      )}
    </>
  );
}
