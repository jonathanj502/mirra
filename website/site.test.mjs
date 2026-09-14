import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
test('all website pages have working local links, accessible landmarks, and no fabricated store downloads', () => {
  const config = JSON.parse(readFileSync(join(root, 'release.json')));
  for (const name of ['index.html', 'privacy.html', 'terms.html', 'support.html', 'delete-account.html']) {
    const html = readFileSync(join(root, 'dist', name), 'utf8');
    assert.match(html, /<html lang="en"/);
    assert.match(html, /id="main"/);
    assert.equal((html.match(/<h1[ >]/g) || []).length, 1);
    for (const [, path] of html.matchAll(/(?:href|src)="\.\/([^"#]*)/g)) {
      assert.ok(existsSync(join(root, 'dist', path || 'index.html')), `Missing ${path} from ${name}`);
    }
    if (!config.appStoreUrl) assert.doesNotMatch(html, /href="https:\/\/apps.apple.com/);
    if (!config.playStoreUrl) assert.doesNotMatch(html, /href="https:\/\/play.google.com/);
  }
});
