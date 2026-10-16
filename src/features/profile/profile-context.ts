import { createContext, type Dispatch, type SetStateAction } from 'react';

export type Profile = {
  name: string;
  bio: string;
  avatar?: string;
  location?: string;
  handle?: string;
  gender?: '不公开' | '女' | '男';
};
export type ProfileState = {
  profile: Profile;
  setProfile: Dispatch<SetStateAction<Profile>>;
};

export const ProfileContext = createContext<ProfileState | null>(null);
