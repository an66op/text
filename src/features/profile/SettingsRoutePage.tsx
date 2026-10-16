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
  switch (kind) {
    case 'account':
      return <AccountSettingsPage />;
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
      return <DeviceSettingsPage />;
  }
}
