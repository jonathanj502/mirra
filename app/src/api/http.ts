import { env } from '@/config/env';

export function endpoint(path: string) {
  return `${env.backendUrl.replace(/\/$/, '')}${path}`;
}

export async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const detail = body?.detail ?? 'Request failed';
    throw new Error(typeof detail === 'string' ? detail : 'Request failed');
  }
  return body as T;
}
