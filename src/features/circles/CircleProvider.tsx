import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useContent } from '../content/useContent';
import { useProfile } from '../profile/useProfile';
import { avatar } from '@/shared/lib/media';
import { readStorage, writeStorage } from '@/shared/lib/storage';
import { CircleContext, type CirclesState } from './circle-context';
import {
  CIRCLES_STORAGE_KEY,
  cleanChannelInput,
  cleanCircleInput,
  deriveCircles,
  emptyCircleStore,
  isCircleStore,
  type CircleExtra,
  type CircleStore,
} from './circle-model';
import { sampleEvents, seedChannels, seedMembers, seedMessages, seedPosts } from './fixtures';
import {
  canManage,
  type Circle,
  type CircleChannel,
  type CircleMember,
  type CirclePost,
} from './types';

export function CircleProvider({ children }: { children: ReactNode }) {
  const content = useContent();
  const { profile } = useProfile();
  const [store, setStore] = useState(() =>
    readStorage(CIRCLES_STORAGE_KEY, emptyCircleStore, isCircleStore),
  );
  const storeRef = useRef(store);
  const contentRef = useRef(content);
  const profileRef = useRef(profile);
  contentRef.current = content;
  profileRef.current = profile;
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== CIRCLES_STORAGE_KEY && event.key !== null) return;
      const next = readStorage(CIRCLES_STORAGE_KEY, emptyCircleStore, isCircleStore);
      storeRef.current = next;
      setStore(next);
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  // Actions read current refs so consecutive writes and navigation in one event stay atomic.
  const actions = useMemo<Omit<CirclesState, 'circles'>>(() => {
    const all = () =>
      deriveCircles(
        contentRef.current.communities,
        contentRef.current.memberships,
        storeRef.current,
      );
    const find = (id: string) => all().find((circle) => circle.id === id);
    const requireCircle = (id: string) => {
      const circle = find(id);
      if (!circle) throw new Error('圈子不存在或已被删除');
      return circle;
    };
    const requireMember = (id: string) => {
      const circle = requireCircle(id);
      if (!circle.joined) throw new Error('请先加入圈子');
      return circle;
    };
    const requireManager = (id: string, ownerOnly = false) => {
      const circle = requireMember(id);
      if (!canManage(circle) || (ownerOnly && circle.role !== 'owner'))
        throw new Error(ownerOnly ? '只有圈主可以进行此操作' : '只有圈主或管理员可以进行此操作');
      return circle;
    };
    const extraFor = (id: string) => storeRef.current.circles[id] ?? {};
    const rawChannels = (id: string): CircleChannel[] => extraFor(id).channels ?? seedChannels(id);
    const channel = (id: string, channelId: string) => {
      const circle = requireMember(id);
      const result = rawChannels(id).find((item) => item.id === channelId);
      if (!result) throw new Error('频道不存在或已被删除');
      if (result.access === 'staff' && !canManage(circle))
        throw new Error('此频道仅圈主和管理员可见');
      return result;
    };
    const updateExtra = (id: string, patch: Partial<CircleExtra>): CircleStore => ({
      ...storeRef.current,
      circles: { ...storeRef.current.circles, [id]: { ...extraFor(id), ...patch } },
    });
    const persist = (next: CircleStore) => {
      if (!isCircleStore(next)) throw new Error('圈子数据无效，无法保存');
      if (!writeStorage(CIRCLES_STORAGE_KEY, next))
        throw new Error('保存失败，请检查浏览器存储空间后重试');
    };
    const accept = (next: CircleStore) => {
      storeRef.current = next;
      setStore(next);
    };
    const commit = (next: CircleStore) => {
      persist(next);
      accept(next);
    };
    const legacyItems = () =>
      readStorage(
        'content-communities',
        [],
        (value): value is { id: string }[] =>
          Array.isArray(value) &&
          value.every(
            (item) =>
              !!item && typeof item === 'object' && 'id' in item && typeof item.id === 'string',
          ),
      );
    const legacyJoined = () =>
      readStorage(
        'content-community-ids',
        [],
        (value): value is string[] =>
          Array.isArray(value) && value.every((id) => typeof id === 'string'),
      );
    const bridge = (
      next: CircleStore,
      run: () => void,
      verify: () => boolean,
      rollback: () => void,
    ) => {
      const previous = storeRef.current;
      persist(next);
      try {
        run();
        if (!verify()) throw new Error('保存失败，请检查浏览器存储空间后重试');
      } catch (error) {
        rollback();
        writeStorage(CIRCLES_STORAGE_KEY, previous);
        throw error;
      }
      accept(next);
    };
    const members = (circle: Circle): CircleMember[] => {
      const others =
        extraFor(circle.id).members ?? (circle.role === 'owner' ? [] : seedMembers(false));
      const result = others.filter((member) => member.id !== 'me');
      return circle.joined
        ? [
            ...result,
            {
              id: 'me',
              name: profileRef.current.name,
              avatar: profileRef.current.avatar || avatar(49),
              role: circle.role as CircleMember['role'],
              online: true,
            },
          ]
        : result;
    };
    const posts = (id: string): CirclePost[] => {
      const seeded = seedPosts(id);
      const saved = extraFor(id).posts;
      if (!saved)
        return seeded.filter((post) => rawChannels(id).some((item) => item.id === post.channelId));
      // Enrich only known demo posts; preserve all saved content and explicit false choices.
      return saved.map((post) => {
        const defaults = seeded.find(
          (seed) => seed.id === post.id && seed.channelId === post.channelId,
        );
        const featured = post.featured ?? defaults?.featured;
        const pinned = post.pinned ?? defaults?.pinned;
        return {
          ...post,
          ...(featured === undefined ? {} : { featured }),
          ...(pinned === undefined ? {} : { pinned }),
        };
      });
    };
    const requirePost = (id: string, postId: string) => {
      requireMember(id);
      const post = posts(id).find((item) => item.id === postId);
      if (!post) throw new Error('帖子不存在或已被删除');
      channel(id, post.channelId);
      return post;
    };
    const author = () => ({
      authorId: 'me',
      authorName: profileRef.current.name,
      avatar: profileRef.current.avatar || avatar(49),
    });
    const text = (value: string, limit = 4000) => {
      if (typeof value !== 'string' || !value.trim()) throw new Error('请输入内容');
      if (value.trim().length > limit) throw new Error(`内容不能超过 ${limit} 字`);
      return value.trim();
    };
    const changePost = (id: string, post: CirclePost) =>
      commit(
        updateExtra(id, { posts: posts(id).map((item) => (item.id === post.id ? post : item)) }),
      );
    return {
      getCircle: find,
      getChannels(id) {
        const circle = find(id);
        if (!circle) return [];
        return rawChannels(id).filter((item) => item.access !== 'staff' || canManage(circle));
      },
      getMembers(id) {
        const circle = find(id);
        return circle?.joined ? members(circle) : [];
      },
      getMessages(id, channelId) {
        const circle = find(id);
        const selected = circle && rawChannels(id).find((item) => item.id === channelId);
        if (!circle?.joined || !selected || (selected.access === 'staff' && !canManage(circle)))
          return [];
        return extraFor(id).messages?.[channelId] ?? seedMessages(selected.id);
      },
      getPosts(id, channelId) {
        const circle = find(id);
        if (!circle?.joined) return [];
        if (
          channelId &&
          !rawChannels(id).some(
            (item) => item.id === channelId && (item.access !== 'staff' || canManage(circle)),
          )
        )
          return [];
        return posts(id).filter(
          (post) =>
            (!channelId || post.channelId === channelId) &&
            rawChannels(id).some(
              (item) =>
                item.id === post.channelId && (item.access !== 'staff' || canManage(circle)),
            ),
        );
      },
      canViewChannel(id, channelId) {
        const circle = find(id);
        const selected = circle && rawChannels(id).find((item) => item.id === channelId);
        return !!(circle?.joined && selected && (selected.access !== 'staff' || canManage(circle)));
      },
      markRead(id, channelId) {
        const selected = channel(id, channelId);
        if (!selected.unread) return;
        commit(
          updateExtra(id, {
            channels: rawChannels(id).map((item) =>
              item.id === channelId ? { ...item, unread: 0 } : item,
            ),
          }),
        );
      },
      joinCircle(id, code) {
        const circle = requireCircle(id);
        if (circle.joined) return;
        if (circle.visibility === 'invite' && code?.trim().toUpperCase() !== circle.inviteCode)
          throw new Error('邀请码不正确，请向圈主索取邀请码');
        const previous = contentRef.current;
        const next = updateExtra(id, {
          joined: true,
          role: 'member',
          memberCountDelta: (extraFor(id).memberCountDelta ?? 0) + 1,
        });
        if (previous.memberships.includes(id)) commit(next);
        else {
          bridge(
            next,
            () => previous.toggleMembership(id),
            () => legacyJoined().includes(id),
            () => previous.toggleMembership(id),
          );
          contentRef.current = { ...previous, memberships: [...previous.memberships, id] };
        }
      },
      leaveCircle(id) {
        const circle = requireMember(id);
        if (circle.role === 'owner') throw new Error('圈主不能退出，请先转让圈主身份或解散圈子');
        const previous = contentRef.current;
        const next = updateExtra(id, {
          joined: false,
          role: 'guest',
          memberCountDelta: (extraFor(id).memberCountDelta ?? 0) - 1,
        });
        if (!previous.memberships.includes(id)) commit(next);
        else {
          bridge(
            next,
            () => previous.toggleMembership(id),
            () => !legacyJoined().includes(id),
            () => previous.toggleMembership(id),
          );
          contentRef.current = {
            ...previous,
            memberships: previous.memberships.filter((item) => item !== id),
          };
        }
      },
      createCircle(input) {
        const clean = cleanCircleInput(input);
        const previous = contentRef.current;
        // Preflight before the legacy provider changes, then validate both persisted stores.
        persist(storeRef.current);
        const id = previous.createCommunity({
          title: clean.name,
          desc: clean.description,
          img: clean.cover,
          badge: `${clean.category}圈子`,
          category: clean.category,
        });
        const next = updateExtra(id, {
          settings: clean,
          joined: true,
          role: 'owner',
          channels: seedChannels(id).map((item) => ({ ...item, unread: 0 })),
          members: [],
          messages: Object.fromEntries(seedChannels(id).map((item) => [item.id, []])),
          posts: [],
          attendance: [],
        });
        try {
          if (!legacyItems().some((item) => item.id === id) || !legacyJoined().includes(id))
            throw new Error('保存失败，请检查浏览器存储空间后重试');
          commit(next);
        } catch (error) {
          previous.deleteCommunity(id);
          throw error;
        }
        contentRef.current = {
          ...previous,
          memberships: [...previous.memberships, id],
          communities: [
            {
              id,
              module: '组织',
              title: clean.name,
              desc: clean.description,
              img: clean.cover,
              badge: `${clean.category}圈子`,
              category: clean.category,
              owner: true,
            },
            ...previous.communities,
          ],
        };
        return id;
      },
      updateCircle(id, changes) {
        const circle = requireManager(id);
        const clean = cleanCircleInput({ ...circle, ...changes });
        const next = updateExtra(id, { settings: clean });
        const previous = contentRef.current;
        const oldItem = previous.communities.find((item) => item.id === id);
        if (!oldItem) {
          commit(next);
          return;
        }
        const patch = {
          title: clean.name,
          desc: clean.description,
          img: clean.cover,
          category: clean.category,
          badge: `${clean.category}圈子`,
        };
        bridge(
          next,
          () => previous.updateCommunity(id, patch),
          () =>
            legacyItems().some(
              (item) =>
                item.id === id &&
                Object.entries(patch).every(
                  ([key, value]) => (item as unknown as Record<string, unknown>)[key] === value,
                ),
            ),
          () => previous.updateCommunity(id, oldItem),
        );
        contentRef.current = {
          ...previous,
          communities: previous.communities.map((item) =>
            item.id === id ? { ...item, ...patch } : item,
          ),
        };
      },
      deleteCircle(id) {
        requireManager(id, true);
        const previous = contentRef.current;
        const oldItem = previous.communities.find((item) => item.id === id);
        if (!oldItem) throw new Error('此圈子不能被解散');
        const next = {
          ...storeRef.current,
          circles: Object.fromEntries(
            Object.entries(storeRef.current.circles).filter(([key]) => key !== id),
          ),
          deleted: [...storeRef.current.deleted, id],
        };
        // Stage all persisted records before the legacy provider mutates its state.
        const nextCommunities = previous.communities.filter((item) => item.id !== id);
        const nextMemberships = previous.memberships.filter((item) => item !== id);
        const nextAttendance = previous.attendance.filter((item) => !item.startsWith(`${id}:`));
        try {
          persist(next);
          if (
            !writeStorage('content-communities', nextCommunities) ||
            !writeStorage('content-community-ids', nextMemberships) ||
            !writeStorage('content-attendance', nextAttendance)
          )
            throw new Error('解散失败，请检查浏览器存储空间后重试');
        } catch (error) {
          writeStorage(CIRCLES_STORAGE_KEY, storeRef.current);
          writeStorage('content-communities', previous.communities);
          writeStorage('content-community-ids', previous.memberships);
          writeStorage('content-attendance', previous.attendance);
          throw error;
        }
        previous.deleteCommunity(id);
        accept(next);
        contentRef.current = {
          ...previous,
          communities: previous.communities.filter((item) => item.id !== id),
          memberships: previous.memberships.filter((item) => item !== id),
        };
      },
      createChannel(id, input) {
        requireManager(id);
        const clean = cleanChannelInput(input);
        const channelId = `channel-${crypto.randomUUID()}`;
        commit(
          updateExtra(id, {
            channels: [...rawChannels(id), { ...clean, id: channelId, circleId: id, unread: 0 }],
          }),
        );
        return channelId;
      },
      updateChannel(id, channelId, changes) {
        requireManager(id);
        const selected = channel(id, channelId);
        const clean = cleanChannelInput({ ...selected, ...changes });
        commit(
          updateExtra(id, {
            channels: rawChannels(id).map((item) =>
              item.id === channelId ? { ...item, ...clean } : item,
            ),
          }),
        );
      },
      deleteChannel(id, channelId) {
        requireManager(id);
        channel(id, channelId);
        commit(
          updateExtra(id, {
            channels: rawChannels(id).filter((item) => item.id !== channelId),
            messages: Object.fromEntries(
              Object.entries(extraFor(id).messages ?? {}).filter(([key]) => key !== channelId),
            ),
            posts: posts(id).filter((post) => post.channelId !== channelId),
            attendance: (extraFor(id).attendance ?? []).filter(
              (key) =>
                !key.startsWith(`${channelId}:`) &&
                (channelId !== 'events' || !sampleEvents.some((event) => event.id === key)),
            ),
          }),
        );
      },
      setMemberRole(id, memberId, role) {
        const circle = requireManager(id, true);
        const member = members(circle).find((item) => item.id === memberId);
        if (!member) throw new Error('成员不存在');
        if (member.id === 'me' || member.role === 'owner')
          throw new Error('不能更改圈主或自己的身份');
        if (!['admin', 'member'].includes(role)) throw new Error('成员身份无效');
        commit(
          updateExtra(id, {
            members: members(circle)
              .filter((item) => item.id !== 'me')
              .map((item) => (item.id === memberId ? { ...item, role } : item)),
          }),
        );
      },
      removeMember(id, memberId) {
        const circle = requireManager(id);
        const member = members(circle).find((item) => item.id === memberId);
        if (!member) throw new Error('成员不存在');
        if (
          member.id === 'me' ||
          member.role === 'owner' ||
          (circle.role !== 'owner' && member.role === 'admin')
        )
          throw new Error('无权移除此成员');
        commit(
          updateExtra(id, {
            members: members(circle).filter((item) => item.id !== 'me' && item.id !== memberId),
            memberCountDelta: (extraFor(id).memberCountDelta ?? 0) - 1,
          }),
        );
      },
      sendMessage(id, channelId, draft) {
        const selected = channel(id, channelId);
        if (selected.type !== 'text' && selected.type !== 'announcement')
          throw new Error('请在文字频道中发送消息');
        if (selected.type === 'announcement') requireManager(id);
        const message = {
          id: crypto.randomUUID(),
          ...author(),
          text: text(draft),
          createdAt: Date.now(),
        };
        commit(
          updateExtra(id, {
            messages: {
              ...extraFor(id).messages,
              [channelId]: [
                ...(extraFor(id).messages?.[channelId] ?? seedMessages(channelId)),
                message,
              ],
            },
          }),
        );
      },
      addPost(id, channelId, input) {
        const selected = channel(id, channelId);
        if (selected.type !== 'forum' && selected.type !== 'announcement')
          throw new Error('请在论坛或公告频道中发布');
        if (selected.type === 'announcement') requireManager(id);
        const post: CirclePost = {
          id: crypto.randomUUID(),
          circleId: id,
          channelId,
          ...author(),
          title: text(input.title, 120),
          text: text(input.text),
          image: input.image?.trim() || undefined,
          createdAt: Date.now(),
          likes: 0,
          liked: false,
          comments: [],
        };
        commit(updateExtra(id, { posts: [post, ...posts(id)] }));
        return post.id;
      },
      addComment(id, postId, draft) {
        const post = requirePost(id, postId);
        changePost(id, {
          ...post,
          comments: [
            ...post.comments,
            {
              id: crypto.randomUUID(),
              ...author(),
              text: text(draft, 2000),
              createdAt: Date.now(),
            },
          ],
        });
      },
      togglePostLike(id, postId) {
        const post = requirePost(id, postId);
        changePost(id, {
          ...post,
          liked: !post.liked,
          likes: Math.max(0, post.likes + (post.liked ? -1 : 1)),
        });
      },
      setPostFeatured(id, postId, featured) {
        requireManager(id);
        const post = requirePost(id, postId);
        if (typeof featured !== 'boolean') throw new Error('精选状态无效');
        changePost(id, { ...post, featured });
      },
      setPostPinned(id, postId, pinned) {
        requireManager(id);
        const post = requirePost(id, postId);
        if (typeof pinned !== 'boolean') throw new Error('置顶状态无效');
        changePost(id, { ...post, pinned });
      },
      toggleEvent(id, eventId, channelId = 'events') {
        requireMember(id);
        const eventChannel = rawChannels(id).find(
          (item) => item.id === channelId && item.type === 'events',
        );
        if (!eventChannel) throw new Error('活动频道不存在');
        channel(id, eventChannel.id);
        if (!sampleEvents.some((event) => event.id === eventId)) throw new Error('活动不存在');
        const attendance = extraFor(id).attendance ?? [];
        const key = `${channelId}:${eventId}`;
        // Bare IDs came from the original canonical events channel only.
        const matches = (item: string) =>
          item === key || (channelId === 'events' && item === eventId);
        commit(
          updateExtra(id, {
            attendance: attendance.some(matches)
              ? attendance.filter((item) => !matches(item))
              : [...attendance, key],
          }),
        );
      },
      isAttending(id, eventId, channelId = 'events') {
        const circle = find(id);
        const eventChannel =
          circle && rawChannels(id).find((item) => item.id === channelId && item.type === 'events');
        if (
          !circle?.joined ||
          !eventChannel ||
          (eventChannel.access === 'staff' && !canManage(circle))
        )
          return false;
        if (!sampleEvents.some((event) => event.id === eventId)) return false;
        const attendance = extraFor(id).attendance ?? [];
        return (
          attendance.includes(`${channelId}:${eventId}`) ||
          (channelId === 'events' && attendance.includes(eventId))
        );
      },
    };
  }, []);
  const circles = useMemo(
    () => deriveCircles(content.communities, content.memberships, store),
    [content.communities, content.memberships, store],
  );
  const value = useMemo(() => ({ circles, ...actions }), [circles, actions]);
  return <CircleContext.Provider value={value}>{children}</CircleContext.Provider>;
}
