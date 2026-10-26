import AccountSettingsPage from './AccountSettingsPage';
import PrivacySettingsPage from './PrivacySettingsPage';
import NotificationSettingsPage from './NotificationSettingsPage';
import ContentSettingsPage from './ContentSettingsPage';
import AboutSettingsPage from './AboutSettingsPage';
import {
  BlockedContactsPage,
  DeviceSettingsPage,
  SecuritySettingsPage,
} from './SettingsSecurityPages';
import './profile.css';
import { Navigate } from 'react-router';
import { useAuth } from '@/features/platform/useAuth';
import SessionDevicesPage from '@/features/platform/sessions/SessionDevicesPage';

export default function SettingsRoutePage({
  kind,
}: {
  kind:
    | 'account'
    | 'security'
    | 'privacy'
    | 'notifications'
    | 'content'
    | 'about'
    | 'blocked'
    | 'devices';
}) {
  const { user, status } = useAuth();
  switch (kind) {
    case 'account':
      return user ? <Navigate to="/account" replace /> : <AccountSettingsPage />;
    case 'security':
      return <SecuritySettingsPage />;
    case 'privacy':
      return <PrivacySettingsPage />;
    case 'notifications':
      return <NotificationSettingsPage />;
    case 'content':
      return <ContentSettingsPage />;
    case 'about':
      return <AboutSettingsPage />;
    case 'blocked':
      return <BlockedContactsPage />;
    case 'devices':
      return status === 'guest' && !user ? <DeviceSettingsPage /> : <SessionDevicesPage />;
  }
}
