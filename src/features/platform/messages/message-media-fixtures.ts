import { member } from '../platform-test-fixtures';
import type { PlatformMessage } from '@/shared/api/types';
export const msg = (id = 'one', revision = 1): PlatformMessage => ({
  id,
  conversationId: 'chat',
  sender: member,
  body: `private-${id}`,
  createdAt: '2026-10-27T08:00:00Z',
  seq: 1,
  status: 'sent',
  revision,
  images: [],
  replyTo: null,
  canRetract: true,
  retractedAt: null,
});
