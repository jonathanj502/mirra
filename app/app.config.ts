import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  if (process.env.EAS_BUILD_PROFILE === 'production' || process.env.MIRRA_RELEASE_BUILD === '1') {
    for (const key of ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_MIRRA_BACKEND_URL', 'EXPO_PUBLIC_WEBSITE_URL']) {
      const url = new URL(process.env[key] || 'http://localhost');
      if (url.protocol !== 'https:' || /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname)) {
        throw new Error(`${key} must be a public HTTPS URL for production builds.`);
      }
    }
    if (!process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) throw new Error('A public Supabase key is required. Never use a service-role key in the app.');
  }
  return { ...config, name: 'Mirra', slug: 'mirra' };
};
