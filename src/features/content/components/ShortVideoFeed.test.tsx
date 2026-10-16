import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/shared/ui/ToastProvider';
import { ProfileProvider } from '@/features/profile/profile-store';
import { ContentProvider } from '../ContentProvider';
import ShortVideoFeed from './ShortVideoFeed';

describe('short video playback preference', () => {
  beforeEach(() => localStorage.clear());

  it.each([true, false])('respects the saved autoplay preference: %s', (enabled) => {
    localStorage.setItem('preferences', JSON.stringify({ 自动播放预览: enabled }));
    render(
      <MemoryRouter>
        <ToastProvider>
          <ProfileProvider>
            <ContentProvider>
              <ShortVideoFeed query="" />
            </ContentProvider>
          </ProfileProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    const video = screen.getByLabelText('山野来信的短视频');
    if (enabled) expect(video).toHaveAttribute('autoplay');
    else expect(video).not.toHaveAttribute('autoplay');
    expect(video).toHaveAttribute('controls');
  });
});
