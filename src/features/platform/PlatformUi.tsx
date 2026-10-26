import { LogIn, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { PublicUser } from '@/shared/api/types';
import { loginPath } from './auth-paths';
import { imageUrl } from './platform-format';

export function PlatformAvatar({ user }: { user: Pick<PublicUser, 'name' | 'avatar'> }) {
  const src = imageUrl(user.avatar);
  const [failed, setFailed] = useState('');
  return src && failed !== src ? (
    <img
      className="platform-avatar"
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed(src)}
    />
  ) : (
    <span className="platform-avatar platform-avatar-letter" aria-hidden="true">
      {user.name.slice(0, 1) || '共'}
    </span>
  );
}

export function PlatformError({ message, retry }: { message: string; retry?: () => void }) {
  if (!message) return null;
  return (
    <div className="platform-error" role="alert">
      <span>{message}</span>
      {retry && (
        <button type="button" onClick={retry}>
          <RefreshCw size={15} />
          重试
        </button>
      )}
    </div>
  );
}

export function LoginNotice({
  returnTo,
  text = '登录后，加入这场对话',
}: {
  returnTo: string;
  text?: string;
}) {
  return (
    <div className="platform-login-notice">
      <span>{text}</span>
      <Link to={loginPath(returnTo)}>
        <LogIn size={16} />
        登录
      </Link>
    </div>
  );
}
