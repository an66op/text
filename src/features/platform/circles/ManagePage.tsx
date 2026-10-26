import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import ActionDialog from '@/shared/ui/ActionDialog';
import { PlatformError } from '../PlatformUi';
import CirclePage from './CirclePage';
import CircleForm from './CircleForm';
import { circlesApi } from './api';
import { useCircle } from './circle-context';
import { circlePaths } from './paths';
import type { Channel, ChannelInput } from './types';
import { useMutation } from './useMutation';
import { useResource } from './useResource';
import { Empty, Pagination } from './Ui';
export default function ManagePage() {
  return (
    <CirclePage title="管理" manager>
      <Manage />
    </CirclePage>
  );
}
function Manage() {
  const { circle, deny, refresh } = useCircle(),
    navigate = useNavigate();
  const [tab, setTab] = useState('profile'),
    [archiving, setArchiving] = useState(false),
    [notice, setNotice] = useState('');
  const mutation = useMutation(deny),
    writable = circle.status === 'active';
  return (
    <>
      <nav className="sc-manager-links">
        <Link to={circlePaths.members(circle.id)}>成员与审批 ↗</Link>
        <Link to={circlePaths.invite(circle.id)}>邀请记录 ↗</Link>
      </nav>
      <div className="sc-tabs" role="tablist" aria-label="圈子管理分类">
        {(
          [
            ['profile', '资料'],
            ['channels', '频道'],
            ['review', '审核'],
          ] as const
        ).map(([id, label]) => (
          <button
            role="tab"
            type="button"
            key={id}
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {notice && (
        <p role="status" className="sc-success">
          {notice}
        </p>
      )}
      {tab === 'profile' ? (
        <>
          <CircleForm
            initial={circle}
            busy={mutation.busy || !writable}
            error={mutation.error}
            label="保存圈子资料"
            submit={async (input) => {
              if (await mutation.run((signal) => circlesApi.update(circle.id, input, signal))) {
                refresh();
                setNotice('圈子资料已保存');
              }
            }}
          />
          {circle.role === 'owner' && writable && (
            <button className="sc-danger sc-leave" type="button" onClick={() => setArchiving(true)}>
              归档圈子
            </button>
          )}
        </>
      ) : tab === 'channels' ? (
        <Channels writable={writable} />
      ) : (
        <Review writable={writable} />
      )}
      {archiving && (
        <ActionDialog
          title={`归档「${circle.name}」？`}
          confirmLabel="确认归档圈子"
          busy={mutation.busy}
          danger
          onClose={() => setArchiving(false)}
          onConfirm={async () => {
            if ((await mutation.run((signal) => circlesApi.archive(circle.id, signal)))?.ok)
              navigate(circlePaths.home(circle.id), { replace: true });
          }}
        >
          <p>
            归档后现有成员可以阅读历史，但不能再加入、发帖、互动或修改成员频道。归档数据会保留，这里没有恢复入口。
          </p>
          <PlatformError message={mutation.error} />
        </ActionDialog>
      )}
    </>
  );
}
function Channels({ writable }: { writable: boolean }) {
  const { circle, deny } = useCircle();
  const [editing, setEditing] = useState<Channel | null>(null),
    [creating, setCreating] = useState(false);
  const list = useResource(circle.id, (signal) => circlesApi.channels(circle.id, signal), deny);
  return (
    <>
      <div className="sc-section-heading">
        <h2>圈子频道</h2>
        {writable && (
          <button
            type="button"
            onClick={() => {
              setCreating(true);
              setEditing(null);
            }}
          >
            新建频道
          </button>
        )}
      </div>
      <PlatformError message={list.error} retry={list.refresh} />
      {(creating || editing) && (
        <ChannelEditor
          key={editing?.id || 'new'}
          channel={editing}
          close={() => {
            setCreating(false);
            setEditing(null);
          }}
          saved={() => {
            setCreating(false);
            setEditing(null);
            list.refresh();
          }}
          writable={writable}
        />
      )}
      {list.loading ? (
        <Empty>正在读取频道…</Empty>
      ) : (
        list.data?.items.map((channel) => (
          <article className="sc-request-card" key={channel.id}>
            <Link to={circlePaths.channel(circle.id, channel.id)}>
              <strong>{channel.name}</strong>
            </Link>
            <p>{channel.description}</p>
            <small>
              {channel.kind === 'forum' ? '讨论' : '公告'} ·{' '}
              {channel.access === 'staff' ? '仅圈方' : '圈内成员'} ·{' '}
              {channel.archived ? '已归档' : '使用中'}
            </small>
            {writable && (
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setEditing(channel);
                }}
              >
                编辑频道
              </button>
            )}
          </article>
        ))
      )}
    </>
  );
}
function ChannelEditor({
  channel,
  close,
  saved,
  writable,
}: {
  channel: Channel | null;
  close: () => void;
  saved: () => void;
  writable: boolean;
}) {
  const { circle, deny } = useCircle(),
    mutation = useMutation(deny);
  const [value, setValue] = useState<ChannelInput>(
      channel || { name: '', description: '', kind: 'forum', access: 'members' },
    ),
    [archived, setArchived] = useState(!!channel?.archived);
  return (
    <form
      className="sc-form sc-card"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!writable || !value.name.trim()) return;
        const input = {
          name: value.name.trim(),
          description: value.description.trim(),
          kind: value.kind,
          access: value.access,
        };
        const next = await mutation.run((signal) =>
          channel
            ? circlesApi.updateChannel(circle.id, channel.id, { ...input, archived }, signal)
            : circlesApi.createChannel(circle.id, input, signal),
        );
        if (next) saved();
      }}
    >
      <h2>{channel ? '编辑频道' : '创建频道'}</h2>
      <label>
        频道名称
        <input
          required
          maxLength={40}
          disabled={mutation.busy || !writable}
          value={value.name}
          onChange={(event) => setValue({ ...value, name: event.target.value })}
        />
      </label>
      <label>
        频道说明
        <textarea
          maxLength={300}
          disabled={mutation.busy || !writable}
          value={value.description}
          onChange={(event) => setValue({ ...value, description: event.target.value })}
        />
      </label>
      <div className="sc-form-pair">
        <label>
          频道类型
          <select
            disabled={mutation.busy || !writable}
            value={value.kind}
            onChange={(event) =>
              setValue({ ...value, kind: event.target.value as ChannelInput['kind'] })
            }
          >
            <option value="forum">讨论</option>
            <option value="announcement">公告</option>
          </select>
        </label>
        <label>
          访问范围
          <select
            disabled={mutation.busy || !writable}
            value={value.access}
            onChange={(event) =>
              setValue({ ...value, access: event.target.value as ChannelInput['access'] })
            }
          >
            <option value="members">圈内成员</option>
            <option value="staff">仅圈主/管理员</option>
          </select>
        </label>
      </div>
      {channel && (
        <label className="sc-check">
          <input
            type="checkbox"
            checked={archived}
            disabled={mutation.busy || !writable}
            onChange={(event) => setArchived(event.target.checked)}
          />
          归档频道，保留历史并停止发布/互动
        </label>
      )}
      <PlatformError message={mutation.error} />
      <div className="sc-form-pair">
        <button type="button" className="sc-secondary" disabled={mutation.busy} onClick={close}>
          取消
        </button>
        <button className="sc-primary" disabled={mutation.busy || !writable || !value.name.trim()}>
          保存频道
        </button>
      </div>
    </form>
  );
}
function Review({ writable }: { writable: boolean }) {
  const { circle, deny } = useCircle();
  const [status, setStatus] = useState('pending'),
    [page, setPage] = useState(0),
    [notice, setNotice] = useState('');
  const mutation = useMutation(deny);
  const list = useResource(
    `${circle.id}:${status}:${page}`,
    (signal) => circlesApi.posts(circle.id, { status, limit: 20, offset: page * 20 }, signal),
    deny,
  );
  return (
    <>
      <div className="sc-section-heading">
        <h2>内容审核</h2>
        <button type="button" onClick={list.refresh}>
          刷新审核
        </button>
      </div>
      <select
        className="sc-select"
        aria-label="审核帖子状态"
        value={status}
        onChange={(event) => {
          setStatus(event.target.value);
          setPage(0);
        }}
      >
        <option value="pending">待审核</option>
        <option value="hidden">已隐藏</option>
        <option value="published">已发布</option>
      </select>
      <PlatformError message={mutation.error || list.error} retry={list.refresh} />
      {notice && (
        <p className="sc-success" role="status">
          {notice}
        </p>
      )}
      {list.loading ? (
        <Empty>正在读取审核列表…</Empty>
      ) : list.data?.items.length ? (
        list.data.items.map((post) => (
          <article className="sc-review-card" key={post.id}>
            <Link to={circlePaths.post(circle.id, post.id)}>
              <h2>{post.title}</h2>
            </Link>
            <p>{post.body}</p>
            <small>
              {post.author.name} · {post.images.length} 张图片
            </small>
            <div>
              <button
                disabled={mutation.busy || !writable}
                onClick={async () => {
                  if (
                    await mutation.run((signal) =>
                      circlesApi.updatePost(circle.id, post.id, { status: 'published' }, signal),
                    )
                  ) {
                    list.refresh();
                    setNotice('已审核发布到圈内');
                  }
                }}
              >
                审核发布
              </button>
              <button
                disabled={mutation.busy || !writable}
                onClick={async () => {
                  if (
                    await mutation.run((signal) =>
                      circlesApi.updatePost(circle.id, post.id, { status: 'hidden' }, signal),
                    )
                  ) {
                    list.refresh();
                    setNotice('帖子已隐藏');
                  }
                }}
              >
                隐藏
              </button>
              <button
                disabled={mutation.busy || !writable}
                onClick={async () => {
                  if (
                    await mutation.run((signal) =>
                      circlesApi.updatePost(
                        circle.id,
                        post.id,
                        { featured: !post.featured },
                        signal,
                      ),
                    )
                  )
                    list.refresh();
                }}
              >
                {post.featured ? '取消精华' : '精华'}
              </button>
              <button
                disabled={mutation.busy || !writable}
                onClick={async () => {
                  if (
                    await mutation.run((signal) =>
                      circlesApi.updatePost(circle.id, post.id, { pinned: !post.pinned }, signal),
                    )
                  )
                    list.refresh();
                }}
              >
                {post.pinned ? '取消置顶' : '置顶'}
              </button>
            </div>
          </article>
        ))
      ) : (
        !list.error && <Empty>当前没有这个状态的帖子。</Empty>
      )}
      <Pagination
        page={page}
        total={list.data?.total ?? 0}
        disabled={list.loading}
        onPage={setPage}
      />
    </>
  );
}
