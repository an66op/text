export type MatchingProfile = {
  id: string;
  name: string;
  age: number;
  gender: 'woman' | 'man';
  city: string;
  occupation: string;
  photo: string;
  bio: string;
  interests: string[];
  intention: 'date' | 'friends' | 'both';
  likesYou: boolean;
  prompts: { question: string; answer: string }[];
};
const portrait = (photo: string) =>
  `https://images.unsplash.com/${photo}?auto=format&fit=crop&w=1000&q=85`;
export const matchingProfiles: MatchingProfile[] = [
  {
    id: 'lin-you',
    name: '林柚',
    age: 26,
    gender: 'woman',
    city: '上海',
    occupation: '视觉设计师',
    photo: portrait('photo-1534528741775-53994a69daeb'),
    bio: '周末常在美术馆和街角咖啡店之间。喜欢拍下路上的光，也想认识愿意慢慢聊天的人。',
    interests: ['摄影', '咖啡', '看展'],
    intention: 'both',
    likesYou: true,
    prompts: [
      { question: '理想的周末', answer: '一场小展，一杯手冲，然后沿着没有走过的街道散步。' },
      { question: '想一起尝试', answer: '去海边看一次日出，拍一卷不赶时间的胶片。' },
    ],
  },
  {
    id: 'chen-yu',
    name: '陈屿',
    age: 29,
    gender: 'man',
    city: '杭州',
    occupation: '建筑设计师',
    photo: portrait('photo-1506794778202-cad84cf45f1d'),
    bio: '工作时画房子，休息时走山路。最近开始学做意面，愿意用一顿晚饭交换你的旅行故事。',
    interests: ['徒步', '旅行', '烹饪'],
    intention: 'date',
    likesYou: false,
    prompts: [
      { question: '最近的小快乐', answer: '完成了一条一直想走的山脊线，回程还碰上了很好的晚霞。' },
      { question: '想认识怎样的人', answer: '对日常有好奇心，也愿意坦诚表达自己。' },
    ],
  },
  {
    id: 'xu-nian',
    name: '许念',
    age: 25,
    gender: 'woman',
    city: '上海',
    occupation: '独立书店编辑',
    photo: portrait('photo-1524504388940-b1c1722653e1'),
    bio: '书架上总有没读完的小说，耳机里常放独立音乐。想找可以交换书单、一起去现场的朋友。',
    interests: ['阅读', '音乐', '电影'],
    intention: 'friends',
    likesYou: true,
    prompts: [
      {
        question: '我可以聊很久的话题',
        answer: '某个故事的结尾，以及一首歌为什么会让人想起夏天。',
      },
      { question: '想一起尝试', answer: '挑一场都没听过的乐队演出，结束后聊聊喜欢的那首歌。' },
    ],
  },
  {
    id: 'zhou-ye',
    name: '周野',
    age: 31,
    gender: 'man',
    city: '上海',
    occupation: '产品经理',
    photo: portrait('photo-1519085360753-af0119f7cbe7'),
    bio: '每周跑步三次，偶尔做一顿复杂的饭。比起热闹的聚会，更喜欢两个人认真聊一件小事。',
    interests: ['跑步', '咖啡', '电影'],
    intention: 'both',
    likesYou: false,
    prompts: [
      { question: '生活里想保留的习惯', answer: '早起跑一小段路，给自己煮早餐，然后再开始一天。' },
      { question: '最好的聊天开场', answer: '分享今天遇到的一个有趣细节。' },
    ],
  },
  {
    id: 'song-yu',
    name: '宋予',
    age: 28,
    gender: 'woman',
    city: '杭州',
    occupation: '插画师',
    photo: portrait('photo-1517841905240-472988babdf9'),
    bio: '喜欢植物、手作和不太拥挤的地方。正在练习把普通的周三也过得有一点特别。',
    interests: ['看展', '阅读', '旅行'],
    intention: 'date',
    likesYou: true,
    prompts: [
      { question: '最近在学习', answer: '陶艺。第一只杯子歪了一点，但已经成了最常用的那只。' },
      { question: '理想的相处方式', answer: '一起做喜欢的事，也给彼此自在独处的时间。' },
    ],
  },
  {
    id: 'lu-an',
    name: '陆安',
    age: 34,
    gender: 'man',
    city: '成都',
    occupation: '纪录片剪辑师',
    photo: portrait('photo-1500648767791-00dcc994a43e'),
    bio: '用影像记下路上遇到的人。刚回到成都，想找一起打球、看电影或爬山的新朋友。',
    interests: ['摄影', '徒步', '电影'],
    intention: 'friends',
    likesYou: false,
    prompts: [
      {
        question: '最喜欢的城市角落',
        answer: '老街的小茶馆。可以发呆，也可以听到很多有意思的故事。',
      },
      { question: '想一起尝试', answer: '带一台相机出门，给彼此拍一组不摆姿势的照片。' },
    ],
  },
];
export const matchingInterests = [
  ...new Set(matchingProfiles.flatMap((profile) => profile.interests)),
];
export const matchingCities = [...new Set(matchingProfiles.map((profile) => profile.city))];
export const MATCHING_STORAGE_KEY = 'matching-demo-v1';
export type MatchingPreferences = {
  minAge: number;
  maxAge: number;
  gender: 'all' | MatchingProfile['gender'];
  city: string;
  intention: 'all' | 'date' | 'friends';
  interests: string[];
};
export type MatchingDecision = { profileId: string; choice: 'like' | 'skip'; createdAt: number };
export type MatchingState = {
  version: 1;
  preferences: MatchingPreferences;
  decisions: MatchingDecision[];
  undo: { kind: 'decision' | 'reset' | 'restore'; decisions: MatchingDecision[] } | null;
};
export const defaultMatchingPreferences: MatchingPreferences = {
  minAge: 18,
  maxAge: 45,
  gender: 'all',
  city: 'all',
  intention: 'all',
  interests: [],
};
export const defaultMatchingState: MatchingState = {
  version: 1,
  preferences: defaultMatchingPreferences,
  decisions: [],
  undo: null,
};
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const age = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 18 && value <= 80;
export function isMatchingPreferences(value: unknown): value is MatchingPreferences {
  return (
    object(value) &&
    age(value.minAge) &&
    age(value.maxAge) &&
    value.minAge <= value.maxAge &&
    ['all', 'woman', 'man'].includes(value.gender as string) &&
    (value.city === 'all' || matchingCities.includes(value.city as string)) &&
    ['all', 'date', 'friends'].includes(value.intention as string) &&
    Array.isArray(value.interests) &&
    value.interests.every(
      (interest) => typeof interest === 'string' && matchingInterests.includes(interest),
    ) &&
    new Set(value.interests).size === value.interests.length
  );
}
function isDecisions(value: unknown): value is MatchingDecision[] {
  return (
    Array.isArray(value) &&
    value.length <= matchingProfiles.length &&
    value.every(
      (decision) =>
        object(decision) &&
        matchingProfiles.some((profile) => profile.id === decision.profileId) &&
        ['like', 'skip'].includes(decision.choice as string) &&
        typeof decision.createdAt === 'number' &&
        Number.isFinite(decision.createdAt) &&
        decision.createdAt >= 0,
    ) &&
    new Set(value.map((decision) => decision.profileId)).size === value.length
  );
}
export function isMatchingState(value: unknown): value is MatchingState {
  return (
    object(value) &&
    value.version === 1 &&
    isMatchingPreferences(value.preferences) &&
    isDecisions(value.decisions) &&
    (value.undo === null ||
      (object(value.undo) &&
        ['decision', 'reset', 'restore'].includes(value.undo.kind as string) &&
        isDecisions(value.undo.decisions)))
  );
}
export function eligibleProfiles(
  profiles: MatchingProfile[],
  preferences: MatchingPreferences,
): MatchingProfile[] {
  return profiles.filter(
    (profile) =>
      profile.age >= 18 &&
      profile.age >= preferences.minAge &&
      profile.age <= preferences.maxAge &&
      (preferences.gender === 'all' || profile.gender === preferences.gender) &&
      (preferences.city === 'all' || profile.city === preferences.city) &&
      (preferences.intention === 'all' ||
        profile.intention === 'both' ||
        profile.intention === preferences.intention) &&
      (!preferences.interests.length ||
        preferences.interests.some((interest) => profile.interests.includes(interest))),
  );
}
export function decideProfile(
  state: MatchingState,
  profileId: string,
  choice: MatchingDecision['choice'],
): MatchingState {
  if (!matchingProfiles.some((profile) => profile.id === profileId && profile.age >= 18))
    throw new Error('这份资料暂时无法查看');
  return {
    ...state,
    decisions: [
      ...state.decisions.filter((decision) => decision.profileId !== profileId),
      { profileId, choice, createdAt: Date.now() },
    ],
    undo: { kind: 'decision', decisions: state.decisions },
  };
}
export function restoreProfile(state: MatchingState, profileId: string): MatchingState {
  return {
    ...state,
    decisions: state.decisions.filter((decision) => decision.profileId !== profileId),
    undo: { kind: 'restore', decisions: state.decisions },
  };
}
export function resetMatchingRound(state: MatchingState): MatchingState {
  return {
    ...state,
    decisions: state.decisions.filter((decision) => decision.choice === 'like'),
    undo: { kind: 'reset', decisions: state.decisions },
  };
}
export function undoMatching(state: MatchingState): MatchingState {
  return state.undo ? { ...state, decisions: state.undo.decisions, undo: null } : state;
}
export function matchedProfiles(state: MatchingState): MatchingProfile[] {
  return matchingProfiles.filter(
    (profile) =>
      profile.likesYou &&
      state.decisions.some(
        (decision) => decision.profileId === profile.id && decision.choice === 'like',
      ),
  );
}
export const matchingPaths = {
  discover: '/match',
  preferences: '/match/preferences',
  connections: '/match/connections',
  profile: (id: string) => `/match/profile/${encodeURIComponent(id)}`,
} as const;
export const intentionLabels = {
  date: '认真约会',
  friends: '兴趣交友',
  both: '约会或交友',
} as const;
