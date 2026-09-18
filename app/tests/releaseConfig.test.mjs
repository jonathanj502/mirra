import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import ignore from 'ignore';

test('shared text and action colors remain readable on all paper surfaces', () => {
  const source = readFileSync(new URL('../src/theme/tokens.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const exports = {};
  new Function('exports', outputText)(exports);
  const { colors } = exports;
  const luminance = hex => hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
  for (const text of ['ink', 'ink2', 'muted', 'inkSoft', 'terracotta', 'sage', 'lavender', 'coral']) {
    for (const surface of ['bg', 'paper', 'card', 'card2']) {
      assert.ok(contrast(colors[text], colors[surface]) >= 4.5, `${text} on ${surface}`);
    }
  }
  assert.ok(contrast('#FFFFFF', colors.terracotta) >= 4.5, 'primary action label');
});

test('EAS archive excludes credentials and native output while preserving monorepo release checks', () => {
  const rules = ignore().add(readFileSync(new URL('../../.easignore', import.meta.url), 'utf8'));
  for (const path of ['app/.env.local', 'backend/.env', '.recordings/job/audio', 'app/credentials.json', 'app/android/app/debug.keystore', 'app/ios/Mirra/Info.plist', '.mcp.json']) {
    assert.equal(rules.ignores(path), true, path);
  }
  for (const path of ['app/app.json', 'app/eas.json', 'app/plugins/withRecordingService.js', 'website/release.json', 'website/release-check.mjs']) {
    assert.equal(rules.ignores(path), false, path);
  }
});

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
