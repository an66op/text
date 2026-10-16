import { useSyncExternalStore } from 'react';
import {
  createSocialChannel,
  getBroadcastSnapshot,
  publishBroadcast,
  setChannelSubscription,
  setChannelMuted,
  pinBroadcastPost,
  markBroadcastViewed,
  toggleBroadcastReaction,
  addBroadcastComment,
  SOCIAL_CHANNELS_EVENT,
  SOCIAL_CHANNELS_KEY,
} from './social-channels-model';

function subscribe(listener: () => void) {
  const sync = (event: StorageEvent) => {
    if (event.key === SOCIAL_CHANNELS_KEY || event.key === null) listener();
  };
  window.addEventListener(SOCIAL_CHANNELS_EVENT, listener);
  window.addEventListener('storage', sync);
  return () => {
    window.removeEventListener(SOCIAL_CHANNELS_EVENT, listener);
    window.removeEventListener('storage', sync);
  };
}
export function useSocialChannels() {
  const store = useSyncExternalStore(subscribe, getBroadcastSnapshot, getBroadcastSnapshot);
  return {
    channels: store.channels,
    createChannel: createSocialChannel,
    setSubscription: setChannelSubscription,
    publish: publishBroadcast,
    setMuted: setChannelMuted,
    pinPost: pinBroadcastPost,
    markViewed: markBroadcastViewed,
    toggleReaction: toggleBroadcastReaction,
    addComment: addBroadcastComment,
  };
}
