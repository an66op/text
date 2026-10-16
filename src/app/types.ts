export type PrimarySection = 'social' | 'contacts' | 'discover' | 'ai' | 'me';
export type Screen = 'social' | 'business' | 'account' | 'moments' | 'circles' | 'ai';
export type PageMeta = {
  title: string;
  section: PrimarySection;
  screen: Screen;
  level: 'primary' | 'secondary';
};
