import { CalendarDays, MapPin, Users } from 'lucide-react';
import { Link } from 'react-router';
import { circlePaths } from '../paths';
import type { CircleEvent, EventRegistration } from './types';
import { eventTime, phaseLabel, registrationLabel } from './model';
import './events.css';
export function EventStatus({ value }: { value: CircleEvent }) {
  return (
    <div className="sce-status">
      <span>{phaseLabel[value.phase]}</span>
      {value.moderation === 'hidden' && <span className="is-hidden">平台已隐藏</span>}
      {value.lifecycle === 'published' && !value.registrationOpen && <span>当前不接受报名</span>}
    </div>
  );
}
export function EventFacts({ value }: { value: CircleEvent }) {
  return (
    <div className="sce-facts">
      <p>
        <CalendarDays size={16} />
        <span>
          <time dateTime={value.startsAt}>{eventTime(value.startsAt)}</time>
          <br />至 <time dateTime={value.endsAt}>{eventTime(value.endsAt)}</time>
        </span>
      </p>
      <p>
        <MapPin size={16} />
        <span>
          {value.mode === 'online' ? '线上' : '线下'} · {value.location}
        </span>
      </p>
      <p>
        <Users size={16} />
        <span>
          已确认 {value.registeredCount} / {value.capacity} 位 · 候补 {value.waitlistedCount} 位
          {value.registeredCount >= value.capacity && ' · 已满额'}
        </span>
      </p>
    </div>
  );
}
export function RegistrationState({ value }: { value: EventRegistration | null }) {
  return (
    <p className={`sce-mine is-${value?.status || 'none'}`}>
      {registrationLabel(value)}
      {value?.status === 'waitlisted' && (
        <small>
          你已同意在圈子和活动可用、报名截止前有名额时按顺序自动递补；截止后不会临时确认。
        </small>
      )}
    </p>
  );
}
export function EventCard({ value }: { value: CircleEvent }) {
  const date = new Date(value.startsAt);
  return (
    <article className="sce-card">
      <div className="sce-date" aria-hidden="true">
        <span>{date.getMonth() + 1}月</span>
        <strong>{date.getDate()}</strong>
      </div>
      <div>
        <EventStatus value={value} />
        <Link to={circlePaths.event(value.circleId, value.id)}>
          <h2>{value.title}</h2>
        </Link>
        <p>{eventTime(value.startsAt)}</p>
        <p className="sce-location">
          {value.mode === 'online' ? '线上' : '线下'} · {value.location}
        </p>
        <small>
          {value.registeredCount}/{value.capacity} 位 · {value.waitlistedCount} 位候补
          {value.registeredCount >= value.capacity && ' · 已满额'}
        </small>
        <RegistrationState value={value.myRegistration} />
      </div>
    </article>
  );
}
