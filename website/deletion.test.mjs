import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

async function page(config, successfulDelete = true) {
  const elements = Object.fromEntries(['#result', '#sign-in', '#confirmed-account', '#availability', '#account-label', '#delete'].map(id => [id, {
    hidden: true, textContent: '', disabled: false, handlers: {},
    addEventListener(name, handler) { this.handlers[name] = handler; },
  }]));
  elements['#sign-in'].querySelector = () => ({ disabled: false });
  elements['#sign-in'].email = { value: 'test@example.invalid' };
  const requests = [];
  let cleaned = false;
  let confirmed = false;
  runInNewContext(readFileSync(new URL('./delete-account.js', import.meta.url), 'utf8'), {
    URLSearchParams, console,
    location: { hash: '#access_token=test-only-token', pathname: '/delete-account.html', origin: 'https://website.invalid' },
    history: { replaceState: () => { cleaned = true; } },
    document: { querySelector: id => elements[id] }, confirm: () => confirmed,
    fetch: async (url, options) => {
      assert.ok(cleaned, 'Callback credentials must leave the URL before requests start');
      requests.push({ url, options });
      if (url === './release.json') return new Response(JSON.stringify(config));
      if (url.endsWith('/auth/v1/user')) return new Response('{"email":"test@example.invalid"}');
      return successfulDelete ? new Response(null, { status: 204 }) : new Response('{"detail":"Unavailable"}', { status: 503 });
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  return { elements, requests, confirm: () => { confirmed = true; } };
}

test('unconfigured deletion page does not collect email or verify callback credentials', async () => {
  const { elements, requests } = await page({});
  assert.equal(requests.length, 1);
  assert.equal(elements['#sign-in'].hidden, true);
  assert.match(elements['#availability'].textContent, /No email is collected/);
});

test('web deletion requires an authenticated callback and separate confirmation, retaining failed requests', async () => {
  const config = { backendUrl: 'https://api.invalid', supabaseUrl: 'https://project.supabase.co', supabasePublishableKey: 'public-test', operatorName: 'Test', supportEmail: 'test@example.invalid', privacyApproved: true };
  for (const success of [true, false]) {
    const ui = await page(config, success);
    const button = ui.elements['#delete'];
    assert.equal(ui.elements['#confirmed-account'].hidden, false);
    await button.handlers.click({ target: button });
    assert.equal(ui.requests.filter(item => item.options?.method === 'DELETE').length, 0);
    ui.confirm();
    await button.handlers.click({ target: button });
    assert.equal(ui.requests.at(-1).options.headers.Authorization, 'Bearer test-only-token');
    assert.equal(button.disabled, false);
    assert.equal(ui.elements['#confirmed-account'].hidden, success);
    assert.match(ui.elements['#result'].textContent, success ? /have been deleted/ : /Unavailable/);
  }
});
