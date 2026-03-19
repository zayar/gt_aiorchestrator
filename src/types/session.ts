export type GTTokenClaims = {
  id?: string;
  clinicId?: string;
  role?: string;
  appId?: string;
  credential?: string;
  exp?: number;
  iat?: number;
};

export type GTSessionContext = {
  requestId: string;
  accessToken: string;
  refreshToken?: string;
  clinicId: string;
  userId?: string;
  role?: string;
  appType?: string;
  locale?: string;
  timezone: string;
  tokenClaims?: GTTokenClaims;
};
