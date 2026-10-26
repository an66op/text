import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { PlatformError } from '../PlatformUi';
import { useAuth } from '../useAuth';
import ImageUploads from '../media/ImageUploads';
import { useImageUploads } from '../media/useImageUploads';
import CirclePage from './CirclePage';
import { circlesApi } from './api';
import { useCircle } from './circle-context';
import { circlePaths } from './paths';
import { isManager, type Post } from './types';
import { useMutation } from './useMutation';
import { useResource } from './useResource';
import { Empty } from './Ui';
import '../media/media.css';
export default function ComposePage() {
  return (
    <CirclePage title="创作">
      <Compose />
    </CirclePage>
  );
}
function Compose() {
  const { circle, deny } = useCircle(),
    { user } = useAuth();
  const [params] = useSearchParams();
  const [channelId, setChannelId] = useState(params.get('channel') || ''),
    [title, setTitle] = useState(''),
    [body, setBody] = useState(''),
    [posted, setPosted] = useState<Post | null>(null);
  const uploads = useImageUploads(user!.id, circle.id, deny),
    mutation = useMutation(deny),
    file = useRef<HTMLInputElement>(null),
    pending = useRef({ payload: '', clientId: '' });
  const channels = useResource(circle.id, (signal) => circlesApi.channels(circle.id, signal), deny);
  const available =
    channels.data?.items.filter(
      (item) => !item.archived && (item.kind === 'forum' || isManager(circle)),
    ) ?? [];
  const selectedId = available.some((item) => item.id === channelId)
    ? channelId
    : available[0]?.id || '';
  if (posted)
    return (
      <div className="sc-published">
        <h2>{posted.status === 'pending' ? '已提交圈方审核' : '帖子已发布'}</h2>
        <p>
          {posted.status === 'pending'
            ? '审核通过后才会出现在圈内动态。你可以查看自己的帖子与审核进度。'
            : '分享已保存在服务器，圈友可以在频道中看到。'}
        </p>
        <Link className="sc-primary" to={circlePaths.post(circle.id, posted.id)}>
          查看帖子
        </Link>
        <Link to={circlePaths.home(circle.id)}>返回圈子</Link>
      </div>
    );
  if (circle.status !== 'active') return <Empty>圈子当前不可发布新内容。</Empty>;
  return (
    <>
      <PlatformError message={channels.error} retry={channels.refresh} />
      {channels.loading ? (
        <Empty>正在确认创作权限…</Empty>
      ) : !available.length ? (
        <Empty>暂时没有可发布的频道。公告主帖仅圈方可发布。</Empty>
      ) : (
        <form
          className="sc-form sc-compose"
          onSubmit={async (event) => {
            event.preventDefault();
            if (
              !uploads.ready ||
              !title.trim() ||
              !body.trim() ||
              !available.some((item) => item.id === selectedId)
            )
              return;
            const input = {
              channelId: selectedId,
              title: title.trim(),
              body: body.trim(),
              images: uploads.urls,
            };
            const payload = JSON.stringify(input);
            if (pending.current.payload !== payload)
              pending.current = { payload, clientId: crypto.randomUUID() };
            const result = await mutation.run((signal) =>
              circlesApi.createPost(
                circle.id,
                { ...input, clientId: pending.current.clientId },
                signal,
              ),
            );
            if (result) setPosted(result);
          }}
        >
          <label>
            发布频道
            <select
              value={selectedId}
              disabled={mutation.busy}
              onChange={(event) => setChannelId(event.target.value)}
            >
              {available.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            帖子标题
            <input
              required
              maxLength={120}
              value={title}
              disabled={mutation.busy}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            帖子正文
            <textarea
              required
              maxLength={5000}
              rows={8}
              value={body}
              disabled={mutation.busy}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          <ImageUploads uploads={uploads} disabled={mutation.busy} />
          <input
            className="sr-only"
            ref={file}
            type="file"
            accept="image/jpeg,image/png"
            multiple
            aria-label="选择圈帖图片"
            disabled={mutation.busy || uploads.items.length >= 9}
            onChange={(event) => {
              uploads.add(Array.from(event.target.files || []));
              event.target.value = '';
            }}
          />
          <button
            className="sc-secondary"
            type="button"
            disabled={mutation.busy || uploads.items.length >= 9}
            onClick={() => file.current?.click()}
          >
            添加圈内图片 · {uploads.items.length}/9
          </button>
          <p className="sc-muted">
            JPEG / PNG · 单张 8 MiB；图片只绑定此圈，不能用于世界公开帖。图片帖需要圈方审核。
          </p>
          <Link className="sc-text-button" to="/account/uploads">
            管理我的上传 ↗
          </Link>
          <PlatformError message={mutation.error || uploads.error} />
          <button
            type="submit"
            className="sc-primary"
            disabled={mutation.busy || !uploads.ready || !title.trim() || !body.trim()}
          >
            {mutation.busy ? '正在提交…' : '提交帖子'}
          </button>
        </form>
      )}
    </>
  );
}
