import { useId, useState, type FormEvent } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { useNavigate } from 'react-router';
import PageHeader from '@/shared/ui/PageHeader';
import { useToast } from '@/shared/ui/useToast';
import {
  defaultMatchingPreferences,
  eligibleProfiles,
  isMatchingPreferences,
  matchingCities,
  matchingInterests,
  matchingPaths,
  matchingProfiles,
  type MatchingPreferences,
} from './matching-model';
import type { useMatching } from './useMatching';

export function MatchingPreferencesPage({
  preferences,
  save,
}: {
  preferences: MatchingPreferences;
  save: ReturnType<typeof useMatching>['save'];
}) {
  const [draft, setDraft] = useState<MatchingPreferences>({
    ...preferences,
    interests: [...preferences.interests],
  });
  const [minAge, setMinAge] = useState(String(preferences.minAge));
  const [maxAge, setMaxAge] = useState(String(preferences.maxAge));
  const [error, setError] = useState('');
  const fieldId = useId();
  const navigate = useNavigate();
  const notify = useToast();
  const candidate = { ...draft, minAge: Number(minAge), maxAge: Number(maxAge) };
  const count = isMatchingPreferences(candidate)
    ? eligibleProfiles(matchingProfiles, candidate).length
    : 0;
  const toggleInterest = (interest: string) =>
    setDraft((previous) => ({
      ...previous,
      interests: previous.interests.includes(interest)
        ? previous.interests.filter((item) => item !== interest)
        : [...previous.interests, interest],
    }));
  const reset = () => {
    setDraft({ ...defaultMatchingPreferences, interests: [] });
    setMinAge('18');
    setMaxAge('45');
    setError('');
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!isMatchingPreferences(candidate)) {
      setError('年龄需为 18–80 岁的整数，且最小年龄不能大于最大年龄。');
      return;
    }
    try {
      save((previous) => ({ ...previous, preferences: candidate }));
      notify('匹配偏好已保存');
      navigate(matchingPaths.discover);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存失败，请重试');
    }
  };
  return (
    <section className="matching-page">
      <PageHeader title="匹配偏好" backTo={matchingPaths.discover} />
      <form className="matching-page-body matching-preferences-form" onSubmit={submit} noValidate>
        <section className="matching-info-card">
          <h2>基本偏好</h2>
          <div className="matching-preference-field">
            <label>
              年龄范围 <small>仅限成年人</small>
            </label>
            <div className="matching-age-fields">
              <label>
                <span className="matching-sr-only">最小年龄</span>
                <input
                  className="field"
                  type="number"
                  min={18}
                  max={80}
                  step={1}
                  inputMode="numeric"
                  value={minAge}
                  onChange={(event) => setMinAge(event.target.value)}
                />
              </label>
              <span>至</span>
              <label>
                <span className="matching-sr-only">最大年龄</span>
                <input
                  className="field"
                  type="number"
                  min={18}
                  max={80}
                  step={1}
                  inputMode="numeric"
                  value={maxAge}
                  onChange={(event) => setMaxAge(event.target.value)}
                />
              </label>
              <span>岁</span>
            </div>
          </div>
          <div className="matching-preference-field">
            <label htmlFor={`${fieldId}-gender`}>想认识</label>
            <select
              id={`${fieldId}-gender`}
              className="field"
              value={draft.gender}
              onChange={(event) =>
                setDraft({ ...draft, gender: event.target.value as MatchingPreferences['gender'] })
              }
            >
              <option value="all">不限性别</option>
              <option value="woman">女生</option>
              <option value="man">男生</option>
            </select>
          </div>
          <div className="matching-preference-field">
            <label htmlFor={`${fieldId}-city`}>城市</label>
            <select
              id={`${fieldId}-city`}
              className="field"
              value={draft.city}
              onChange={(event) => setDraft({ ...draft, city: event.target.value })}
            >
              <option value="all">不限城市</option>
              {matchingCities.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
            </select>
            <p>按资料中的城市筛选</p>
          </div>
          <div className="matching-preference-field">
            <label htmlFor={`${fieldId}-intention`}>期待的关系</label>
            <select
              id={`${fieldId}-intention`}
              className="field"
              value={draft.intention}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  intention: event.target.value as MatchingPreferences['intention'],
                })
              }
            >
              <option value="all">不限</option>
              <option value="date">认真约会</option>
              <option value="friends">兴趣交友</option>
            </select>
          </div>
        </section>
        <section className="matching-info-card">
          <h2>兴趣</h2>
          <p>不限，或选择至少一个感兴趣的话题。</p>
          <div className="matching-interest-picker">
            {matchingInterests.map((interest) => (
              <button
                type="button"
                key={interest}
                aria-pressed={draft.interests.includes(interest)}
                onClick={() => toggleInterest(interest)}
              >
                {draft.interests.includes(interest) && <Check size={13} />}
                {interest}
              </button>
            ))}
          </div>
          <p className="matching-interest-note">选中多个兴趣时，符合任意一个即可。</p>
        </section>
        {error && (
          <p className="matching-error" role="alert">
            {error}
          </p>
        )}
        <p className="matching-preference-count">
          当前有 <strong>{count}</strong> 位示例资料符合偏好
        </p>
        <button className="primary" type="submit">
          保存偏好
        </button>
        <button className="matching-text-button" type="button" onClick={reset}>
          <RotateCcw size={14} />
          恢复默认
        </button>
      </form>
    </section>
  );
}
