import { pictures } from '../content/fixtures';
import { avatar } from '@/shared/lib/media';
import type { CircleChannel, CircleMember, CircleMessage, CirclePost } from './types';

export const sampleEvents = [
  {
    id: 'city-photowalk',
    title: '周日，一起捕捉城市的光',
    date: '10 月 18 日 · 周日 16:00',
    location: '上海 · 武康路街区',
    description:
      '带上手机或相机，从街角的咖啡店出发。沿途寻找光影、建筑与小小的日常，最后一起分享今天最喜欢的一张照片。新朋友也欢迎参加。',
  },
  {
    id: 'photo-review',
    title: '本周作品分享夜',
    date: '10 月 21 日 · 周三 20:00',
    location: '圈子 · 语音客厅',
    description: '每人准备 1–3 张最近拍下的照片，聊聊画面背后的故事。无需专业设备，分享观察就好。',
  },
];
export const sampleResources = [
  {
    id: 'reading-list',
    title: '影像灵感书单',
    description: '从阅读开始，发现更有趣的观察方式。',
    href: '/bookshelf',
  },
  {
    id: 'photo-topics',
    title: '城市漫游话题',
    description: '看看大家正在讨论的摄影与生活灵感。',
    href: '/world/topics',
  },
];
export const circleCategoryIcons: Record<string, string> = {
  摄影: '📷',
  户外: '🏕️',
  读书: '📚',
  生活: '☕',
  游戏: '🎮',
  创作: '✨',
};
export function seedChannels(circleId: string): CircleChannel[] {
  return [
    {
      id: 'welcome',
      name: '欢迎与公告',
      description: '从这里了解圈子规则、新朋友指南和最新通知。',
      type: 'announcement' as const,
      category: '开始了解',
      access: 'members' as const,
      unread: 1,
    },
    {
      id: 'general',
      name: '日常闲聊',
      description: '打个招呼，聊聊今天遇见的小事。',
      type: 'text' as const,
      category: '一起交流',
      access: 'members' as const,
      unread: 3,
    },
    {
      id: 'photos',
      name: '作品分享',
      description: '分享你的照片、灵感与正在创作的作品。',
      type: 'forum' as const,
      category: '一起交流',
      access: 'members' as const,
      unread: 2,
    },
    {
      id: 'lounge',
      name: '语音客厅',
      description: '进来坐坐，用声音遇见彼此。',
      type: 'voice' as const,
      category: '一起交流',
      access: 'members' as const,
      unread: 0,
    },
    {
      id: 'events',
      name: '圈子活动',
      description: '一起出发，让线上的相遇走到生活里。',
      type: 'events' as const,
      category: '共同参与',
      access: 'members' as const,
      unread: 1,
    },
    {
      id: 'resources',
      name: '共享资源',
      description: '收藏书单、实用工具和大家的经验。',
      type: 'resources' as const,
      category: '共同参与',
      access: 'members' as const,
      unread: 0,
    },
    {
      id: 'staff',
      name: '管理小屋',
      description: '管理员协作、讨论圈子日常事务。',
      type: 'text' as const,
      category: '共同参与',
      access: 'staff' as const,
      unread: 0,
    },
  ].map((channel) => ({ ...channel, circleId }));
}
export function seedMembers(ownerIsMe: boolean): CircleMember[] {
  return [
    {
      id: 'achuan',
      name: '阿川',
      avatar: avatar(12),
      role: ownerIsMe ? 'member' : 'owner',
      online: true,
    },
    { id: 'lin', name: '林间晚风', avatar: avatar(47), role: 'member', online: true },
    { id: 'mia', name: 'Mia', avatar: avatar(44), role: 'member', online: false },
    { id: 'beidao', name: '北岛', avatar: avatar(13), role: 'member', online: false },
  ];
}
export function seedMessages(channelId: string): CircleMessage[] {
  if (channelId === 'general')
    return [
      {
        id: 'hello-achuan',
        authorId: 'achuan',
        authorName: '阿川',
        avatar: avatar(12),
        text: '下午好！今天路过一条很漂亮的小巷，光刚好落在墙上。周末有空一起去走走吗？',
        createdAt: 1792029600000,
      },
      {
        id: 'hello-lin',
        authorId: 'lin',
        authorName: '林间晚风',
        avatar: avatar(47),
        text: '想去！我最近也在练习用手机记录日常 📷',
        createdAt: 1792029660000,
      },
      {
        id: 'hello-mia',
        authorId: 'mia',
        authorName: 'Mia',
        avatar: avatar(44),
        text: '我带咖啡来～希望这次可以拍到好看的夕阳。',
        createdAt: 1792029720000,
      },
    ];
  if (channelId === 'welcome')
    return [
      {
        id: 'welcome-achuan',
        authorId: 'achuan',
        authorName: '阿川',
        avatar: avatar(12),
        text: '欢迎来到我们的圈子 👋\n在这里，分享日常的观察与灵感，也一起做些有趣的事。\n\n请友善交流、尊重原创；先在日常闲聊里介绍自己，作品发到作品分享，约伴请到圈子活动。遇到问题，随时联系管理员。',
        createdAt: 1791943200000,
      },
    ];
  if (channelId === 'staff')
    return [
      {
        id: 'staff-achuan',
        authorId: 'achuan',
        authorName: '阿川',
        avatar: avatar(12),
        text: '这周的散步活动已更新。欢迎一起补充路线和新朋友指南。',
        createdAt: 1792029600000,
      },
    ];
  return [];
}
export function seedPosts(circleId: string): CirclePost[] {
  return [
    {
      id: 'blue-hour',
      circleId,
      channelId: 'photos',
      authorId: 'achuan',
      authorName: '阿川',
      avatar: avatar(12),
      title: '今天的蓝调时刻，分享给你',
      text: '天还没完全黑的时候，城市会短暂地变成深蓝色。等了十分钟，终于等到这一盏灯亮起来。你最喜欢在什么时候拍照？',
      image: pictures.city,
      createdAt: 1792026000000,
      likes: 24,
      liked: false,
      featured: true,
      comments: [
        {
          id: 'blue-hour-lin',
          authorId: 'lin',
          authorName: '林间晚风',
          avatar: avatar(47),
          text: '这个颜色太温柔了，下次一起去！',
          createdAt: 1792026600000,
        },
      ],
    },
    {
      id: 'coffee-corner',
      circleId,
      channelId: 'photos',
      authorId: 'mia',
      authorName: 'Mia',
      avatar: avatar(44),
      title: '街角新发现的一家小店',
      text: '一杯咖啡，一束下午的阳光。原来有趣的风景，就藏在每天走过的路上。',
      image: pictures.coffee,
      createdAt: 1791943200000,
      likes: 18,
      liked: false,
      comments: [],
    },
    {
      id: 'community-guide',
      circleId,
      channelId: 'welcome',
      authorId: 'achuan',
      authorName: '阿川',
      avatar: avatar(12),
      title: '欢迎来到圈子 · 从这里认识彼此',
      text: '欢迎每一位新朋友 👋\n\n我们一起记录生活、分享灵感，也给彼此多一点鼓励。先到日常闲聊介绍自己，再把喜欢的作品发到作品分享。\n\n圈子约定：友善表达、尊重原创，分享他人的作品请注明来源；不发布广告或他人隐私。遇到问题，可以在成员列表里找到管理员。\n\n不用等到足够专业，今天的一个小发现，就值得被看见。',
      createdAt: 1791856800000,
      likes: 32,
      liked: false,
      pinned: true,
      comments: [
        {
          id: 'guide-lin',
          authorId: 'lin',
          authorName: '林间晚风',
          avatar: avatar(47),
          text: '已读，期待认识大家！',
          createdAt: 1791860400000,
        },
      ],
    },
    {
      id: 'weekend-announcement',
      circleId,
      channelId: 'welcome',
      authorId: 'achuan',
      authorName: '阿川',
      avatar: avatar(12),
      title: '周末活动公告 · 一起捕捉城市的光',
      text: '这周日 16:00，我们从武康路街角出发，用一个下午观察城市里的光。手机、相机都可以，也欢迎只想来散步的新朋友。\n\n带一瓶水，穿舒适的鞋。集合地点和路线会在活动频道持续更新，请在圈子活动里报名，方便我们统计人数。若遇下雨，会在日常闲聊通知改期。',
      createdAt: 1792022400000,
      likes: 16,
      liked: false,
      comments: [
        {
          id: 'weekend-mia',
          authorId: 'mia',
          authorName: 'Mia',
          avatar: avatar(44),
          text: '周日见，我会带咖啡来～',
          createdAt: 1792024200000,
        },
      ],
    },
  ];
}
