import { RouterProvider } from 'react-router/dom';
import ErrorBoundary from '@/app/ErrorBoundary';
import { router } from '@/app/router';
import { ContentProvider } from '@/features/content/ContentProvider';
import { ProfileProvider } from '@/features/profile/profile-store';
import { SocialProvider } from '@/features/social/SocialProvider';
import { ToastProvider } from '@/shared/ui/ToastProvider';
import { CircleProvider } from '@/features/circles/CircleProvider';

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <ProfileProvider>
          <ContentProvider>
            <CircleProvider>
              <SocialProvider>
                <RouterProvider router={router} />
              </SocialProvider>
            </CircleProvider>
          </ContentProvider>
        </ProfileProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
