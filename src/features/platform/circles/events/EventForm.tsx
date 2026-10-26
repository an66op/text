import { useRef, useState } from 'react';
import ActionDialog from '@/shared/ui/ActionDialog';
import { PlatformError } from '../../PlatformUi';
import { useCircle } from '../circle-context';
import { useMutation } from '../useMutation';
import { eventsApi } from './api';
import { eventForm, eventInput, timeZone, type EventFormValue } from './model';
import type { CircleEvent } from './types';
export default function EventForm({
  initial,
  current,
  saved,
  reloaded,
}: {
  initial?: CircleEvent;
  current?: CircleEvent;
  saved: (value: CircleEvent) => void;
  reloaded: (value: CircleEvent) => void;
}) {
  const { circle, deny } = useCircle(),
    mutation = useMutation(deny);
  const [baseline, setBaseline] = useState(initial),
    [value, setValue] = useState(() => eventForm(initial)),
    [validation, setValidation] = useState(''),
    [reloading, setReloading] = useState(false);
  const pending = useRef({ payload: '', clientId: '' });
  const writable =
    circle.status === 'active' &&
    (!current || (current.lifecycle === 'published' && current.phase === 'upcoming'));
  const change = (key: keyof EventFormValue, text: string) =>
    setValue((previous) => ({ ...previous, [key]: text }));
  return (
    <>
      <p className="sc-muted">
        时区：{timeZone()} · 本地日期提交时转换为 UTC，报名截止与活动状态由服务器决定。
      </p>
      {current?.moderation === 'hidden' && (
        <p className="sc-notice">活动已被平台隐藏。修改资料或取消活动不会恢复公开可见性。</p>
      )}
      {!writable && <p className="sc-notice">已取消或已开始的活动不可编辑，当前草稿已保留。</p>}
      {baseline && current && current.revision !== baseline.revision && (
        <p className="sc-notice">活动已更新，当前草稿保留。请重新载入后核实。</p>
      )}
      <form
        className="sc-form sce-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!writable || mutation.busy) return;
          let input;
          try {
            input = eventInput(value, baseline);
            setValidation('');
          } catch (error) {
            setValidation(error instanceof Error ? error.message : '请检查活动资料');
            return;
          }
          const payload = JSON.stringify(input);
          if (pending.current.payload !== payload)
            pending.current = { payload, clientId: crypto.randomUUID() };
          const result = await mutation.run((signal) =>
            baseline
              ? eventsApi.update(
                  circle.id,
                  baseline.id,
                  { ...input, revision: baseline.revision },
                  signal,
                )
              : eventsApi.create(
                  circle.id,
                  { ...input, clientId: pending.current.clientId },
                  signal,
                ),
          );
          if (result) saved(result);
        }}
      >
        <label>
          活动标题
          <input
            required
            maxLength={80}
            value={value.title}
            disabled={mutation.busy || !writable}
            onChange={(event) => change('title', event.target.value)}
          />
        </label>
        <label>
          活动介绍
          <textarea
            required
            maxLength={4000}
            rows={7}
            value={value.description}
            disabled={mutation.busy || !writable}
            onChange={(event) => change('description', event.target.value)}
          />
        </label>
        <div className="sc-form-pair">
          <label>
            活动形式
            <select
              value={value.mode}
              disabled={mutation.busy || !writable}
              onChange={(event) => change('mode', event.target.value)}
            >
              <option value="offline">线下</option>
              <option value="online">线上</option>
            </select>
          </label>
          <label>
            确认名额
            <input
              required
              type="number"
              min={1}
              max={1000}
              step={1}
              value={value.capacity}
              disabled={mutation.busy || !writable}
              onChange={(event) => change('capacity', event.target.value)}
            />
          </label>
        </div>
        <label>
          {value.mode === 'online' ? '线上活动方式' : '活动地点'}
          <textarea
            required
            maxLength={200}
            rows={2}
            value={value.location}
            disabled={mutation.busy || !writable}
            onChange={(event) => change('location', event.target.value)}
            placeholder={
              value.mode === 'online'
                ? '填写文字说明，不会自动打开会议链接'
                : '填写集合地点，无需精确定位'
            }
          />
        </label>
        <label>
          开始时间
          <input
            required
            type="datetime-local"
            value={value.startsAt}
            disabled={mutation.busy || !writable}
            onChange={(event) => change('startsAt', event.target.value)}
          />
        </label>
        <label>
          结束时间
          <input
            required
            type="datetime-local"
            value={value.endsAt}
            disabled={mutation.busy || !writable}
            onChange={(event) => change('endsAt', event.target.value)}
          />
        </label>
        <label>
          报名截止
          <input
            required
            type="datetime-local"
            value={value.registrationClosesAt}
            disabled={mutation.busy || !writable}
            onChange={(event) => change('registrationClosesAt', event.target.value)}
          />
        </label>
        <p className="sc-muted">
          活动最长 7 天，最多提前 365 天；截止前有空位时按候补顺序自动递补。名额不能少于已确认人数。
        </p>
        <PlatformError message={validation || mutation.error} />
        {mutation.error && baseline && (
          <p className="sc-muted">草稿未被覆盖。活动更新后，请先重新载入并核对，再保存。</p>
        )}
        <button className="sc-primary" type="submit" disabled={mutation.busy || !writable}>
          {mutation.busy ? '正在提交…' : baseline ? '保存活动' : '发布活动'}
        </button>
        {baseline && (
          <button
            className="sc-secondary"
            type="button"
            disabled={mutation.busy}
            onClick={() => setReloading(true)}
          >
            重新载入服务器资料
          </button>
        )}
      </form>
      {reloading && baseline && (
        <ActionDialog
          title="重新载入活动资料？"
          confirmLabel="确认重新载入"
          busy={mutation.busy}
          onClose={() => setReloading(false)}
          onConfirm={async () => {
            const result = await mutation.run((signal) =>
              eventsApi.detail(circle.id, baseline.id, signal),
            );
            if (result) {
              setBaseline(result);
              setValue(eventForm(result));
              setValidation('');
              setReloading(false);
              reloaded(result);
            }
          }}
        >
          <p>这会替换当前尚未保存的草稿，并载入最新活动资料。</p>
          <PlatformError message={mutation.error} />
        </ActionDialog>
      )}
    </>
  );
}
