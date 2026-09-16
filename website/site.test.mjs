import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';

const root = dirname(fileURLToPath(import.meta.url));
test('promotional actions lead to stores only when available, with consistent availability copy', () => {
  const source = readFileSync(join(root, 'build.mjs'), 'utf8').replace(/^import .*;\r?$/gm, '').replace('import.meta.url', 'buildUrl');
  const originalConfig = JSON.parse(readFileSync(join(root, 'release.json')));
  for (const [appStoreUrl, playStoreUrl] of [
    ['', ''], ['https://apps.apple.com/app/id123', ''], ['', 'https://play.google.com/store/apps/details?id=com.mirra.app'],
  ]) {
    const pages = new Map();
    runInNewContext(source, {
      readFileSync: (path, encoding) => path === join(root, 'release.json')
        ? JSON.stringify({ ...originalConfig, appStoreUrl, playStoreUrl }) : readFileSync(path, encoding),
      writeFileSync: (path, content) => pages.set(path, content), mkdirSync() {}, copyFileSync() {},
      join, dirname, fileURLToPath, createHash, URL, buildUrl: new URL('./build.mjs', import.meta.url).href,
      console: { log() {} },
    });
    const home = pages.get(join(root, 'dist/index.html'));
    const main = home.match(/<main[^>]*>([\s\S]*?)<\/main>/)[1];
    assert.doesNotMatch(main, /href="(?:\.\/)?#/); // Keep orientation links in navigation, not promotional copy.
    assert.doesNotMatch(home, /\{\{|aria-disabled="true"|See the quick debrief|See how little it takes/);
    if (appStoreUrl || playStoreUrl) {
      assert.ok(home.includes(`href="${appStoreUrl || playStoreUrl}"`));
      assert.doesNotMatch(main, /downloads are not available yet|Coming first to iPhone/);
    } else {
      assert.doesNotMatch(home, /class="(?:header-cta|button secondary)"|>Get Mirra/);
      assert.match(main, /Coming first to iPhone/);
      assert.match(main, /Store downloads are not available yet/);
    }
  }
});

test('all website pages have working local links, accessible landmarks, and no fabricated store downloads', () => {
  const config = JSON.parse(readFileSync(join(root, 'release.json')));
  const css = readFileSync(join(root, 'dist/styles.css'), 'utf8');
  for (const [, asset] of css.matchAll(/url\('\.\/([^']+)'\)/g)) {
    assert.ok(existsSync(join(root, 'dist', asset)), `Missing stylesheet asset ${asset}`);
  }
  for (const name of ['index.html', 'privacy.html', 'terms.html', 'support.html', 'delete-account.html']) {
    const html = readFileSync(join(root, 'dist', name), 'utf8');
    assert.doesNotMatch(html, /\u2014|&mdash;|&#0*8212;|&#x0*2014;/i, `Em dash in ${name}`);
    assert.match(html, /<html lang="en"/);
    assert.match(html, /id="main"/);
    assert.equal((html.match(/<h1[ >]/g) || []).length, 1);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => id);
    assert.equal(ids.length, new Set(ids).size, `Duplicate IDs in ${name}`);
    for (const [, path, fragment] of html.matchAll(/href="(?:\.\/([^"#]*))?#([^"#]+)"/g)) {
      const destination = path === undefined ? html : readFileSync(join(root, 'dist', path || 'index.html'), 'utf8');
      assert.ok(destination.includes(`id="${fragment}"`), `Missing anchor ${fragment} from ${name}`);
    }
    for (const [, path] of html.matchAll(/(?:href|src)="\.\/([^"#]*)/g)) {
      assert.ok(existsSync(join(root, 'dist', path.split('?')[0] || 'index.html')), `Missing ${path} from ${name}`);
    }
    if (!config.appStoreUrl) assert.doesNotMatch(html, /href="https:\/\/apps.apple.com/);
    if (!config.playStoreUrl) assert.doesNotMatch(html, /href="https:\/\/play.google.com/);
  }
});

test('preview starts with one panel, supports click and keyboard navigation, and closes the mobile menu', () => {
  const html = readFileSync(join(root, 'dist/index.html'), 'utf8');
  let focused;
  function element(tag = '') {
    const attributes = Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
    return {
      attributes, hidden: /\bhidden(?:\s|>)/.test(tag), handlers: {},
      tabIndex: Number(attributes.tabindex || 0),
      setAttribute(key, value) { this.attributes[key] = value; },
      getAttribute(key) { return this.attributes[key]; },
      addEventListener(key, handler) { this.handlers[key] = handler; },
      focus() { focused = this; },
    };
  }
  const tags = role => [...html.matchAll(new RegExp(`<[^>]+role="${role}"[^>]*>`, 'g'))].map(([tag]) => element(tag));
  const tabs = tags('tab');
  const panels = tags('tabpanel');
  assert.equal(tabs.length, 3);
  const elements = [...tabs, ...panels];
  const nextButtons = [...html.matchAll(/<button[^>]+data-demo-next="([^"]+)"[^>]*>/g)].map(([, next]) => ({ ...element(), dataset: { demoNext: next } }));
  const summary = element();
  const link = element();
  const menu = { ...element(), open: true, querySelectorAll: () => [link], querySelector: () => summary };
  runInNewContext(readFileSync(join(root, 'site.js'), 'utf8'), { document: {
    querySelectorAll: selector => selector === '[role="tab"]' ? tabs : nextButtons,
    querySelector: () => menu,
    getElementById: id => elements.find(e => e.attributes.id === id),
  } });
  function selected(index) {
    assert.deepEqual(panels.map(p => p.hidden), panels.map((_, i) => i !== index));
    assert.deepEqual(tabs.map(t => t.attributes['aria-selected']), tabs.map((_, i) => String(i === index)));
    assert.deepEqual(tabs.map(t => t.tabIndex), tabs.map((_, i) => i === index ? 0 : -1));
  }
  selected(1);
  tabs[0].handlers.click(); selected(0);
  for (const [from, key, to] of [[0, 'ArrowUp', 2], [2, 'ArrowDown', 0], [0, 'End', 2], [2, 'Home', 0], [0, 'ArrowRight', 1], [1, 'ArrowLeft', 0]]) {
    let prevented = false;
    tabs[from].handlers.keydown({ key, preventDefault() { prevented = true; } });
    assert.ok(prevented); selected(to); assert.equal(focused, tabs[to]);
  }
  for (const button of nextButtons) {
    button.handlers.click();
    const index = tabs.findIndex(t => t.attributes.id === `tab-${button.dataset.demoNext}`);
    selected(index); assert.equal(focused, panels[index]);
  }
  link.handlers.click(); assert.equal(menu.open, false);
  menu.open = true;
  menu.handlers.keydown({ key: 'Escape' });
  assert.equal(menu.open, false); assert.equal(focused, summary);
  assert.doesNotThrow(() => runInNewContext(readFileSync(join(root, 'site.js'), 'utf8'), {
    document: { querySelectorAll: () => [], querySelector: () => null },
  }));
});
