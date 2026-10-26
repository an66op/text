import { lazy } from 'react';

export const AuthPage = lazy(() => import('@/features/platform/AuthPage'));
export const PlatformAccountPage = lazy(() => import('@/features/platform/PlatformAccountPage'));
export const MyUploadsPage = lazy(() => import('@/features/platform/media/MyUploadsPage'));
export const NotificationsPage = lazy(
  () => import('@/features/platform/notifications/NotificationsPage'),
);
export const ServerCirclesPage = lazy(() => import('@/features/platform/circles/DirectoryPage'));
export const ServerCircleCreatePage = lazy(() => import('@/features/platform/circles/CreatePage'));
export const ServerCircleHomePage = lazy(() => import('@/features/platform/circles/HomePage'));
export const ServerCircleChannelPage = lazy(
  () => import('@/features/platform/circles/ChannelPage'),
);
export const ServerCirclePostPage = lazy(() => import('@/features/platform/circles/PostPage'));
export const ServerCircleComposePage = lazy(
  () => import('@/features/platform/circles/ComposePage'),
);
export const ServerCircleMembersPage = lazy(
  () => import('@/features/platform/circles/MembersPage'),
);
export const ServerCircleManagePage = lazy(() => import('@/features/platform/circles/ManagePage'));
export const ServerCircleJoinPage = lazy(() => import('@/features/platform/circles/JoinPage'));
export const ServerCircleInvitePage = lazy(() => import('@/features/platform/circles/InvitePage'));
export const ServerWorldPage = lazy(() => import('@/features/platform/ServerWorldPage'));
export const PlatformMessagesPage = lazy(() => import('@/features/platform/PlatformMessagesPage'));
export const ConversationDetailsPage = lazy(
  () => import('@/features/platform/conversations/ConversationDetailsPage'),
);
export const Web3LabPage = lazy(() => import('@/features/web3/Web3LabPage'));
export const AccountSyncPage = lazy(() => import('@/features/sync/AccountSyncPage'));
export const ContactsPage = lazy(() => import('@/features/people/ContactsPage'));
export const UserProfilePage = lazy(() => import('@/features/people/UserProfilePage'));
export const ServerPostPage = lazy(() => import('@/features/people/ServerPostPage'));

export const SocialPage = lazy(() => import('@/features/social/SocialPage'));
export const SocialRoutePage = lazy(() => import('@/features/social/SocialRoutePage'));
export const DiscoveryPage = lazy(() => import('@/features/discovery/DiscoveryPage'));
export const MomentsPage = lazy(() => import('@/features/content/MomentsPage'));
export const ContentPage = lazy(() => import('@/features/content/ContentPage'));
export const ContentDetailPage = lazy(() => import('@/features/content/ContentDetailPage'));
export const ContentRoutePage = lazy(() => import('@/features/content/ContentRoutePage'));
export const ProfilePage = lazy(() => import('@/features/profile/ProfilePage'));
export const EditProfilePage = lazy(() => import('@/features/profile/EditProfilePage'));
export const SettingsPage = lazy(() => import('@/features/profile/SettingsPage'));
export const SettingsRoutePage = lazy(() => import('@/features/profile/SettingsRoutePage'));
export const WalletPage = lazy(() => import('@/features/wallet/WalletPage'));
export const WalletRoutePage = lazy(() => import('@/features/wallet/WalletRoutePage'));
export const WalletEarnPage = lazy(() => import('@/features/wallet/WalletEarnPage'));
export const MatchingPage = lazy(() => import('@/features/matching/MatchingPage'));
export const SocialChannelPage = lazy(() => import('@/features/social/SocialChannelPage'));
export const ShopPage = lazy(() => import('@/features/shop/ShopPage'));
export const AiPage = lazy(() => import('@/features/ai/AiPage'));
export const CirclesPage = lazy(() => import('@/features/circles/CirclesPage'));
export const CircleShell = lazy(() => import('@/features/circles/CircleShell'));
export const CircleHomePage = lazy(() => import('@/features/circles/CircleHomePage'));
export const CircleChannelPage = lazy(() => import('@/features/circles/ChannelPage'));
export const CircleVoiceRoomPage = lazy(() => import('@/features/circles/VoiceRoomPage'));
export const CirclePostPage = lazy(() =>
  import('@/features/circles/PostPages').then((module) => ({ default: module.CirclePostPage })),
);
export const CircleComposePage = lazy(() =>
  import('@/features/circles/PostPages').then((module) => ({ default: module.CircleComposePage })),
);
export const CircleCreatePage = lazy(() =>
  import('@/features/circles/ManagePages').then((module) => ({ default: module.CircleCreatePage })),
);
export const CircleSettingsPage = lazy(() =>
  import('@/features/circles/ManagePages').then((module) => ({
    default: module.CircleSettingsPage,
  })),
);
export const CircleMembersPage = lazy(() =>
  import('@/features/circles/ManagePages').then((module) => ({
    default: module.CircleMembersPage,
  })),
);
export const CircleInvitePage = lazy(() =>
  import('@/features/circles/ManagePages').then((module) => ({ default: module.CircleInvitePage })),
);
export const CircleJoinPage = lazy(() =>
  import('@/features/circles/ManagePages').then((module) => ({ default: module.CircleJoinPage })),
);
export const CircleChannelEditPage = lazy(() =>
  import('@/features/circles/ManagePages').then((module) => ({
    default: module.CircleChannelEditPage,
  })),
);
