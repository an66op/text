import type { CatalogItem, Post } from './types';
import { catalog } from './fixtures';

export const contentRoutes = {
  compose: '/publish',
  cover: '/activity/cover',
  topics: '/world/topics',
  bookshelf: '/bookshelf',
  author: (name: string) => `/people/${encodeURIComponent(name)}`,
  postActions: (id: number) => `/world/posts/${id}/actions`,
  shortComments: (id: number) => `/shorts/${id}/comments`,
  book: (id: string) => `/books/${encodeURIComponent(id)}`,
  chapters: (id: string) => `/books/${encodeURIComponent(id)}/chapters`,
  readerSettings: (id: string) => `/read/${encodeURIComponent(id)}/settings`,
  results: (id: string) => `/games/${encodeURIComponent(id)}/results`,
  createCommunity: '/organizations/new',
  manageCommunity: (id: string) => `/organizations/${encodeURIComponent(id)}/manage`,
  members: (id: string) => `/organizations/${encodeURIComponent(id)}/members`,
  event: (id: string, eventId: string) =>
    `/organizations/${encodeURIComponent(id)}/events/${eventId}`,
};
export const topicSeeds = [
  { name: '慢生活', desc: '在忙碌里，留一点时间给自己', count: '2.4 万' },
  { name: '城市漫游', desc: '街头、光影，还有发生在身边的故事', count: '1.8 万' },
  { name: '设计灵感', desc: '分享每一个让你眼前一亮的瞬间', count: '8,632' },
  { name: '周末去野', desc: '约上同频的人，去看山海', count: '1.2 万' },
];
export const chapterTitles = [
  '风起的地方',
  '那封没有署名的信',
  '海边的小城',
  '再次相遇',
  '穿过森林',
  '把答案交给时间',
  '远方与故乡',
  '日落之前',
  '一杯咖啡的时间',
  '新的旅途',
  '写给未来的信',
  '山海终有归期',
];
export function getChapterParagraphs(item: CatalogItem, chapter: number) {
  const author = item.desc.split(' 著')[0];
  const first = `${chapter === 1 ? '清晨' : chapter % 2 === 0 ? '傍晚' : '午后'}的风从海面吹来，带着盐的气息。林屿推开窗，看见远处的山在薄雾中渐渐清晰。她终于来到这座惦念了很久的小城。生活像一本未写完的书，而今天，是新的一页。`;
  return [
    first,
    `这是《${item.title}》的第 ${chapter} 章。老街尽头的书店刚刚开门，门口挂着一串风铃。她把行李放在台阶上，抬头看见窗里暖黄的灯光。柜台后的老人正在整理昨天寄来的信，一封、两封，每一封都有远方的温度。`,
    '“你是在等谁吗？”老人问。她摇摇头，又轻轻地点了一下。“也许我只是在等一个开始。”风铃再次响起，街上的声音随着门的合拢变得遥远。她忽然意识到，过去那些匆忙的日子，此刻终于有了一个停下来回望的理由。',
    `在来这里之前，她读过${author}留下的笔记。笔记里写着，人总要走上一段属于自己的路，才会懂得，重要的从来不只是抵达。她拿出那张被折了很多次的地图，在红色标记旁边画了一颗很小的星。`,
    '下午的阳光穿过树叶，在石板路上留下不规则的影子。她沿着海岸走了很久，遇见牵着狗散步的少年、修补渔网的老人，还有骑着单车说说笑笑的朋友。没有人知道她的故事，可每个人都给了她一个毫无保留的微笑。',
    '在日落之前，她坐在码头边，把今天的见闻写进信里。“原来，当我们允许自己慢下来，世界并没有因此停止。它只是用一种更加温柔的方式，告诉我们，所有细小的相遇都值得认真收藏。”',
    '晚风渐渐凉了。远处的船亮起灯，一盏接一盏，像浮在海上的星。她合上本子，起身走回那条熟悉了一天的老街。明天还会有什么呢？她不知道，却第一次不再因为不知道而担心。',
  ];
}
export const seededComments = [
  { author: 'Mia', text: '好喜欢这样的生活！☀️', key: 'seed-mia' },
  { author: '阿川', text: '下次一起出发，记得叫上我！', key: 'seed-achuan' },
];
export const ownPost = (post: Post) => post.owner === true;
export const stableNumber = (value: string) =>
  [...value].reduce((sum, char) => sum * 31 + char.charCodeAt(0), 0) >>> 0;
export function getCommunity(id: string | undefined, created: CatalogItem[]) {
  return [...created, ...catalog.组织].find((item) => item.id === id);
}
export function eventsFor(item: CatalogItem) {
  return [
    {
      id: 'weekend',
      title:
        item.category === '摄影'
          ? '周末街头摄影散步'
          : item.title.includes('读书')
            ? '一本书，一场相遇'
            : '周末伙伴见面会',
      date: '10 月 17 日 · 周六 14:00',
      place: item.desc.split(' · ')[0] + ' · 中心公园入口',
      desc: '带上好奇心和一点轻松的心情，一起认识新伙伴。活动不收取费用，报名后请按时到场。',
      seats: 20,
    },
    {
      id: 'online',
      title: '线上分享夜 · 最近的一个小确幸',
      date: '10 月 23 日 · 周五 20:00',
      place: '线上 · 组织交流空间',
      desc: '每位伙伴分享一个最近的小故事，也可以安静地听别人讲。让快乐在彼此之间传递。',
      seats: 50,
    },
  ];
}
