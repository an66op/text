import { CalendarDays, FolderOpen, Hash, Megaphone, MessageSquare, Volume2 } from 'lucide-react';
import type { CircleChannel } from './types';

export function ChannelIcon({ type, size = 20 }: { type: CircleChannel['type']; size?: number }) {
  const Icon = {
    text: Hash,
    forum: MessageSquare,
    voice: Volume2,
    announcement: Megaphone,
    events: CalendarDays,
    resources: FolderOpen,
  }[type];
  return <Icon size={size} strokeWidth={1.8} />;
}
