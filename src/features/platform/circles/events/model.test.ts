import { describe, expect, it } from 'vitest';
import { eventForm, eventInput, localDateInput, localInputUtc, registrationLabel } from './model';
import { activity, registration } from './test-fixtures';
describe('circle event local date and draft boundaries', () => {
  it('roundtrips local date inputs to UTC and preserves an unchanged server timestamp including microseconds', () => {
    const value = eventForm(activity),
      input = eventInput(value, activity);
    expect(value.startsAt).toBe(localDateInput(activity.startsAt));
    expect(input.startsAt).toBe(activity.startsAt);
    expect(input.endsAt).toBe(activity.endsAt);
    expect(input.registrationClosesAt).toBe(activity.registrationClosesAt);
    const local = '2026-12-02T14:35',
      utc = localInputUtc(local);
    expect(utc.endsWith('Z')).toBe(true);
    expect(localDateInput(utc)).toBe(local);
    expect(new Date(utc).getHours()).toBe(14);
  });
  it('keeps an elapsed original cutoff unchanged during a content edit instead of rounding it into an illegal new past cutoff', () => {
    const old = { ...activity, registrationClosesAt: '2020-01-01T08:45:32.123456Z' };
    const value = eventForm(old);
    value.description = '只修改文字';
    expect(eventInput(value, old).registrationClosesAt).toBe(old.registrationClosesAt);
  });
  it.each(['', '2026-02-30T12:00', '2026-13-01T12:00', '2026-12-01', 'not-a-date'])(
    'rejects impossible or incomplete local time %s',
    (value) => {
      expect(() => localInputUtc(value)).toThrow();
    },
  );
  it('rejects invalid time ordering, capacity or blank content without producing an API payload', () => {
    const value = eventForm(activity);
    expect(() => eventInput({ ...value, endsAt: value.startsAt }, activity)).toThrow(
      '结束须晚于开始',
    );
    expect(() =>
      eventInput({ ...value, registrationClosesAt: localDateInput(activity.endsAt) }, activity),
    ).toThrow('报名截止');
    expect(() => eventInput({ ...value, capacity: '1001' }, activity)).toThrow('1–1000');
    expect(() => eventInput({ ...value, capacity: '1.5' }, activity)).toThrow('整数');
    expect(() =>
      eventInput({ ...value, capacity: '1' }, { ...activity, registeredCount: 2 }),
    ).toThrow('已确认');
    expect(() => eventInput({ ...value, title: '  ' }, activity)).toThrow('标题');
    expect(() =>
      eventInput({ ...value, endsAt: localDateInput('2026-12-10T08:00:00Z') }, activity),
    ).toThrow('7 天');
  });
  it('sends exactly editable fields and describes cancellation or promotion from current server registration', () => {
    expect(Object.keys(eventInput(eventForm(activity), activity)).sort()).toEqual([
      'capacity',
      'description',
      'endsAt',
      'location',
      'mode',
      'registrationClosesAt',
      'startsAt',
      'title',
    ]);
    expect(registrationLabel({ ...registration, status: 'waitlisted', queuePosition: 4 })).toBe(
      '候补第 4 位',
    );
    expect(registrationLabel({ ...registration, status: 'cancelled', reason: 'membership' })).toBe(
      '因成员身份变化取消',
    );
    expect(registrationLabel({ ...registration, status: 'cancelled', reason: 'event' })).toBe(
      '活动取消',
    );
    expect(registrationLabel(null)).toBe('尚未报名');
  });
});
