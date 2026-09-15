import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const valid = {
  EXPO_NO_DOTENV: '1',
  EXPO_PUBLIC_MIRRA_BACKEND_URL: 'https://mirra.onrender.com',
  EXPO_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_test',
};
const check = overrides => spawnSync(process.execPath, ['scripts/check-production-env.cjs'], {
  cwd: new URL('..', import.meta.url), env: { ...process.env, ...valid, ...overrides }, encoding: 'utf8',
});

test('production builds reject missing/local endpoints and privileged keys before bundling', () => {
  assert.equal(check({}).status, 0);
  for (const name of ['EXPO_PUBLIC_MIRRA_BACKEND_URL', 'EXPO_PUBLIC_SUPABASE_URL']) {
    for (const value of ['', 'http://mirra.onrender.com', 'https://127.0.0.1', 'https://10.0.0.2',
      'https://192.168.1.2', 'https://[::1]', 'https://localhost', 'https://host.local',
      'https://host.local.', 'https://user:password@mirra.onrender.com', 'https://mirra.onrender.com?key=secret']) {
      const result = check({ [name]: value });
      assert.notEqual(result.status, 0, `${name}: ${value}`);
      assert.match(result.stderr, new RegExp(name));
    }
  }
  for (const key of ['', 'sb_secret_private', `header.${Buffer.from('{"role":"service_role"}').toString('base64url')}.signature`]) {
    const result = check({ EXPO_PUBLIC_SUPABASE_ANON_KEY: key });
    assert.notEqual(result.status, 0);
    if (key) assert.ok(!result.stderr.includes(key), 'Do not print credentials in build errors');
  }
  const anon = `header.${Buffer.from('{"role":"anon"}').toString('base64url')}.signature`;
  assert.equal(check({ EXPO_PUBLIC_SUPABASE_ANON_KEY: anon }).status, 0);
});
