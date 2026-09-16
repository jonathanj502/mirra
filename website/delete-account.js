// Credentials from the email callback are kept only in memory and removed from the address immediately.
const fragment = new URLSearchParams(location.hash.slice(1));
let token = fragment.get('access_token');
history.replaceState(null, '', location.pathname);
const status = document.querySelector('#result');
const form = document.querySelector('#sign-in');
const panel = document.querySelector('#confirmed-account');
let config;
let available = false;
async function responseBody(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(body.detail || body.msg || body.message || 'Request failed. Please try again.');
  return body;
}
async function setup() {
  config = await fetch('./release.json', { cache: 'no-store' }).then(responseBody);
  if (!config.backendUrl || !config.privacyApproved || !config.supportEmail || !config.operatorName) {
    document.querySelector('#availability').textContent = 'Web deletion is being configured. Use Profile → Account actions → Delete account in the app. No email is collected on this page while it is unavailable.';
    token = null; return;
  }
  if (!config.backendUrl.startsWith('https://')) throw Error('Deletion service is unavailable.');
  available = true;
  document.querySelector('#availability').textContent = 'Verify your existing account, then confirm deletion.';
  form.hidden = false;
  if (token) {
    const user = await fetch(`${config.supabaseUrl}/auth/v1/user`, { headers: { apikey: config.supabasePublishableKey, Authorization: `Bearer ${token}` } }).then(responseBody);
    document.querySelector('#account-label').textContent = `Signed in as ${user.email}.`;
    form.hidden = true; panel.hidden = false;
  }
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!available) return;
  const button = form.querySelector('button'); button.disabled = true;
  try {
    await fetch(`${config.supabaseUrl}/auth/v1/otp?redirect_to=${encodeURIComponent(location.origin + location.pathname)}`, {
      method: 'POST', headers: { apikey: config.supabasePublishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.email.value.trim(), create_user: false }),
    }).then(responseBody);
    status.textContent = 'If this email belongs to a Mirra account, check your inbox for the sign-in link. Nothing has been deleted.';
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});
document.querySelector('#delete').addEventListener('click', async event => {
  if (!available || !token || !confirm('Permanently delete this account and all saved conversations? This cannot be undone.')) return;
  event.target.disabled = true;
  try {
    await fetch(`${config.backendUrl}/account`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).then(responseBody);
    token = null; panel.hidden = true;
    status.textContent = 'Your account and associated saved data have been deleted. Clear Mirra data on other devices to remove any offline recordings there.';
  } catch (error) { status.textContent = error.message; }
  finally { event.target.disabled = false; }
});
setup().catch(error => { available = false; token = null; form.hidden = true; panel.hidden = true; status.textContent = error.message; });
