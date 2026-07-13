import { endpoint, parseResponse } from '@/api/http';

export interface AuthStatus {
  usernamePasswordReady: boolean;
  googleEnabled: boolean;
  emailEnabled: boolean;
  signupDisabled: boolean;
}

type RawAuthStatus = {
  username_password_ready: boolean;
  google_enabled: boolean;
  email_enabled: boolean;
  signup_disabled: boolean;
};

export async function fetchAuthStatus(): Promise<AuthStatus> {
  const body = await fetch(endpoint('/auth/status')).then((r) => parseResponse<RawAuthStatus>(r));
  return {
    usernamePasswordReady: Boolean(body.username_password_ready),
    googleEnabled: Boolean(body.google_enabled),
    emailEnabled: Boolean(body.email_enabled),
    signupDisabled: Boolean(body.signup_disabled),
  };
}
