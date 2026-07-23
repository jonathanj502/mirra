import { env } from '@/config/env';

export function endpoint(path: string) {
  return `${env.backendUrl.replace(/\/$/, '')}${path}`;
}

export async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // Non-JSON body (e.g. an unhandled backend exception returns plain-text "Internal Server Error").
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      throw new Error('Invalid response from server');
    }
  }
  if (!response.ok) {
    const detail = (body as { detail?: unknown })?.detail ?? 'Request failed';
    throw new Error(typeof detail === 'string' ? detail : 'Request failed');
  }
  return body as T;
}

// Surfaces the real backend detail (e.g. a 402's "Monthly debrief limit reached") instead of a
// generic message, while still catching raw fetch-level errors so we don't leak "Failed to fetch".
export function friendlyErrorMessage(err: unknown, fallback: string): string {
  const message = err instanceof Error && err.message ? err.message : fallback;
  if (message === 'Failed to fetch' || message.includes('Network request failed')) {
    return 'Could not reach Mirra. Please try again.';
  }
  return message;
}
