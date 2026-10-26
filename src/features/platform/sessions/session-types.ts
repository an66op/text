export type SessionDevice = {
  id: string;
  device: string;
  createdAt: string | null;
  lastSeenAt: string | null;
  expiresAt: string;
  current: boolean;
  legacy: boolean;
  authMethod: 'unknown' | 'password' | 'wallet';
};

export type SessionDevices = { items: SessionDevice[]; total: number };
export type RevokeSessionResult = { ok: true; current: boolean };
export type RevokeOtherSessionsResult = { revoked: number };
