import { endpoint, parseResponse } from '@/api/http';

export interface BackendAuthSession {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  token_type?: string;
  user: Record<string, unknown>;
}

export async function usernameSignIn(username: string, password: string) {
  return fetch(endpoint('/auth/username/sign-in'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  }).then((r) => parseResponse<BackendAuthSession>(r));
}

export async function usernameSignUp(username: string, password: string) {
  return fetch(endpoint('/auth/username/sign-up'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  }).then((r) => parseResponse<BackendAuthSession>(r));
}
