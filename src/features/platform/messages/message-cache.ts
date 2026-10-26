import type { PlatformMessage, MessageReply } from '@/shared/api/types';
export type CachedMessage = PlatformMessage & { syncing?: boolean };
const revision = (value: { revision?: number }) => value.revision ?? 1;
export const tombstone = (value: PlatformMessage): PlatformMessage => ({
  ...value,
  status: 'retracted',
  body: '',
  images: [],
  replyTo: null,
  canRetract: false,
});
export class MessageCache {
  floor = 0;
  records = new Map<string, PlatformMessage>();
  terminal = new Set<string>();
  missing = new Set<string>();
  pending = new Set<string>();
  sources = new Map<string, MessageReply>();
  quarantined = new Set<string>();
  freeze() {
    for (const id of this.records.keys()) {
      this.quarantined.add(id);
      this.pending.add(id);
    }
    for (const id of this.sources.keys()) this.quarantined.add(id);
  }
  hold(items: PlatformMessage[]) {
    for (const item of items) {
      if (this.missing.has(item.id)) continue;
      if (item.status === 'retracted') {
        this.retract(item.id);
        continue;
      }
      this.quarantined.add(item.id);
      this.pending.add(item.id);
    }
  }
  observe(version: number) {
    if (!Number.isSafeInteger(version) || version <= this.floor) return;
    this.floor = version;
    for (const message of this.records.values())
      if (revision(message) < this.floor + 1) this.pending.add(message.id);
  }
  retract(id: string) {
    this.terminal.add(id);
    this.missing.delete(id);
    const old = this.records.get(id);
    if (old) this.records.set(id, tombstone(old));
    this.pending.add(id);
  }
  accept(items: PlatformMessage[], version?: number, authoritative = false) {
    if (version !== undefined) this.observe(version);
    this.observe(
      Math.max(
        0,
        ...items.flatMap((item) => [(item.revision ?? 1) - 1, (item.replyTo?.revision ?? 1) - 1]),
      ),
    );
    for (const raw of items) {
      if (this.missing.has(raw.id)) continue;
      if (this.quarantined.has(raw.id) && !authoritative && raw.status !== 'retracted') {
        this.pending.add(raw.id);
        continue;
      }
      if (raw.status === 'retracted') this.terminal.add(raw.id);
      const message = this.terminal.has(raw.id) ? tombstone(raw) : raw;
      if (revision(message) < this.floor + 1) {
        this.pending.add(message.id);
        if (this.terminal.has(message.id) && this.records.has(message.id))
          this.records.set(message.id, tombstone(this.records.get(message.id)!));
        continue;
      }
      this.pending.delete(message.id);
      if (authoritative) this.quarantined.delete(message.id);
      const old = this.records.get(message.id);
      if (!old || revision(message) >= revision(old) || message.status === 'retracted')
        this.records.set(message.id, message);
      if (message.replyTo) {
        if (authoritative) this.quarantined.delete(message.replyTo.id);
        const source = this.sources.get(message.replyTo.id);
        if (!source || message.replyTo.revision >= source.revision)
          this.sources.set(message.replyTo.id, message.replyTo);
      }
      const source: MessageReply = {
        id: message.id,
        revision: revision(message),
        available: message.status !== 'retracted',
        sender: message.status === 'retracted' ? null : message.sender,
        body: message.status === 'retracted' ? null : [...message.body].slice(0, 200).join(''),
        imageCount: message.status === 'retracted' ? 0 : (message.images?.length ?? 0),
      };
      if (
        !this.sources.has(message.id) ||
        source.revision >= this.sources.get(message.id)!.revision
      )
        this.sources.set(message.id, source);
    }
  }
  remove(ids: string[]) {
    for (const id of ids) {
      this.records.delete(id);
      this.pending.delete(id);
      this.missing.add(id);
      this.sources.set(id, {
        id,
        revision: this.floor + 1,
        available: false,
        sender: null,
        body: null,
        imageCount: 0,
      });
    }
  }
  quote(reply: MessageReply | null | undefined): MessageReply | null {
    if (!reply) return null;
    if (
      this.quarantined.has(reply.id) ||
      Math.max(reply.revision, this.sources.get(reply.id)?.revision ?? 0) < this.floor + 1 ||
      this.terminal.has(reply.id) ||
      this.missing.has(reply.id)
    )
      return { ...reply, available: false, sender: null, body: null, imageCount: 0 };
    const source = this.sources.get(reply.id);
    return source && source.revision >= reply.revision ? source : reply;
  }
  snapshot(): CachedMessage[] {
    return [...this.records.values()]
      .map((message) => {
        if (this.terminal.has(message.id)) return tombstone(message);
        if (this.quarantined.has(message.id) || revision(message) < this.floor + 1)
          return {
            ...message,
            body: '',
            images: [],
            replyTo: null,
            canRetract: false,
            syncing: true,
          };
        return { ...message, replyTo: this.quote(message.replyTo) };
      })
      .sort(
        (a, b) =>
          (a.seq ?? 0) - (b.seq ?? 0) ||
          a.createdAt.localeCompare(b.createdAt) ||
          a.id.localeCompare(b.id),
      );
  }
}
