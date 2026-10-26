import { describe, it, expect } from 'vitest';
import { MessageCache } from './message-cache';
import { msg } from './message-media-fixtures';
import { member } from '../platform-test-fixtures';

describe('conversation projection monotonicity', () => {
  it('rejects previously unknown old history and send IDs under the global floor', () => {
    const cache = new MessageCache();
    cache.observe(4);
    cache.accept([msg('old-history'), msg('old-send')]);
    expect(cache.snapshot()).toEqual([]);
    expect([...cache.pending]).toEqual(['old-history', 'old-send']);
  });
  it('takes a newer send projection as a floor for all existing and unseen IDs', () => {
    const cache = new MessageCache();
    cache.accept([msg('existing')]);
    cache.accept([msg('fresh', 6)]);
    cache.accept([msg('unknown', 2)]);
    expect(cache.floor).toBe(5);
    expect(cache.snapshot().find((item) => item.id === 'existing')).toMatchObject({
      body: '',
      syncing: true,
    });
    expect(cache.snapshot().some((item) => item.id === 'unknown')).toBe(false);
  });
  it('never restores a tombstone even from a later higher revision sent response', () => {
    const cache = new MessageCache();
    cache.accept([msg()]);
    cache.retract('one');
    cache.accept([msg('one', 9)]);
    expect(cache.snapshot()[0]).toMatchObject({
      status: 'retracted',
      body: '',
      images: [],
      replyTo: null,
    });
  });
  it('does not resurrect a resolved missing ID from equal or newer old pages', () => {
    const cache = new MessageCache();
    cache.accept([msg()]);
    cache.remove(['one']);
    cache.accept([msg(), msg('one', 3)]);
    expect(cache.snapshot()).toEqual([]);
    expect(cache.missing.has('one')).toBe(true);
  });
  it('overrides stale reply snapshots when the retracted source never belonged to the loaded window', () => {
    const cache = new MessageCache();
    cache.retract('source');
    const parent = {
      ...msg('parent'),
      replyTo: {
        id: 'source',
        revision: 1,
        available: true,
        sender: member,
        body: 'secret source',
        imageCount: 3,
      },
    };
    cache.accept([parent]);
    expect(cache.snapshot()[0].replyTo).toMatchObject({
      available: false,
      sender: null,
      body: null,
      imageCount: 0,
    });
  });
  it('redacts input quotes and off-window sources below the new floor', () => {
    const cache = new MessageCache();
    const quote = {
      id: 'source',
      revision: 1,
      available: true,
      sender: member,
      body: 'old private source',
      imageCount: 1,
    };
    cache.accept([{ ...msg(), replyTo: quote }]);
    cache.observe(3);
    expect(cache.quote(quote)).toMatchObject({
      available: false,
      body: null,
      sender: null,
      imageCount: 0,
    });
  });
  it('allows blocked live images to recover on a newer projection, while retracted images never recover', () => {
    const cache = new MessageCache();
    const image = {
      id: 'media_' + 'a'.repeat(32),
      url: '/api/v1/media/images/media_' + 'a'.repeat(32),
      available: true,
      width: 100,
      height: 100,
      bytes: 10,
      contentType: 'image/png' as const,
    };
    cache.accept([{ ...msg(), images: [image] }]);
    cache.accept([{ ...msg('one', 2), images: [{ ...image, url: null, available: false }] }]);
    expect(cache.snapshot()[0].images?.[0].available).toBe(false);
    cache.accept([{ ...msg('one', 3), images: [image] }]);
    expect(cache.snapshot()[0].images?.[0].available).toBe(true);
    cache.retract('one');
    cache.accept([{ ...msg('one', 4), images: [image] }]);
    expect(cache.snapshot()[0].images).toEqual([]);
  });
});
