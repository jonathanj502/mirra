const { isIP } = require('node:net');

// Match Expo's .env loading for local checks. EAS supplies production variables.
process.env.NODE_ENV = 'production';
require('@expo/env').load(process.cwd());

for (const name of ['EXPO_PUBLIC_MIRRA_BACKEND_URL', 'EXPO_PUBLIC_SUPABASE_URL']) {
  let url;
  try { url = new URL(process.env[name]); } catch {}
  const host = url?.hostname.replace(/\.$/, '') ?? '';
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || !host.includes('.') || isIP(host) || host.startsWith('[')
    || /\.(localhost|local|internal|test|invalid|example)$/.test(host)) {
    throw new Error(`${name} must be a public HTTPS URL for the production build.`);
  }
}

const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
let role;
try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role; } catch {}
if (!key.startsWith('sb_publishable_') && role !== 'anon') {
  throw new Error('EXPO_PUBLIC_SUPABASE_ANON_KEY must be a Supabase publishable or anon key.');
}

console.log('Production endpoint and public-key configuration passed. Live connectivity still needs verification.');
