import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

test('production builds reject development endpoints and privileged keys', () => {
  const source = readFileSync(new URL('../app.config.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const valid = { EAS_BUILD_PROFILE: 'production', EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    EXPO_PUBLIC_MIRRA_BACKEND_URL: 'https://api.mirra.app', EXPO_PUBLIC_WEBSITE_URL: 'https://sheanrahman192.github.io/mirra',
    EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_test' };
  const run = env => {
    const exports = {};
    new Function('exports', 'process', outputText)(exports, { env });
    return exports.default({ config: {} });
  };
  assert.equal(run(valid).name, 'Mirra');
  for (const url of ['http://192.168.1.2:8000', 'https://localhost', 'https://[::1]', 'https://api.invalid', 'https://user:secret@api.mirra.app']) {
    assert.throws(() => run({ ...valid, EXPO_PUBLIC_MIRRA_BACKEND_URL: url }), /public HTTPS/);
  }
  for (const key of ['sb_secret_test', 'sk-private', `header.${Buffer.from('{"role":"service_role"}').toString('base64url')}.signature`]) {
    assert.throws(() => run({ ...valid, EXPO_PUBLIC_SUPABASE_ANON_KEY: key }), /public Supabase key/);
  }
});
