// Only these existing, explicitly local demo domains are downloadable here.
// Server identities, message drafts, privacy and capabilities use separate APIs.
const localDemoKeys = [
  'profile',
  'preferences',
  'account-settings-v1',
  'profile-blocked-contacts',
  'wallet-v2',
  'wallet-transfer-draft',
  'balance',
  'transactions',
  'social-conversations',
  'social-messages',
  'social-accepted',
  'social-requests',
  'social-contact-notes',
  'social-tags',
  'social-fixture-version',
  'social-broadcast-channels-v1',
  'posts',
  'likes',
  'bookmarks',
  'follows',
  'comments',
  'joined',
  'chapter',
  'content-bookshelf-ids',
  'content-community-ids',
  'content-cover',
  'content-reading',
  'content-reader-settings',
  'content-game-results',
  'content-communities',
  'content-attendance',
  'content-replies',
  'content-video-progress',
  'content-live-messages',
  'content-publish-draft',
  'circles-state-v1',
  'matching-demo-v1',
  'shop-state-v1',
  'ai-local-demo-v1',
] as const;

export function localDemoExport(storage: Pick<Storage, 'getItem'> = localStorage) {
  return Object.fromEntries(
    localDemoKeys.flatMap((key) => {
      const value = storage.getItem(key);
      return value === null ? [] : [[key, value]];
    }),
  );
}
