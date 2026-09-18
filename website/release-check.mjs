import { readFileSync } from 'node:fs';
const config = JSON.parse(readFileSync(new URL('./release.json', import.meta.url), 'utf8'));
const blockers = [];
for (const key of ['operatorName', 'supportEmail', 'backendUrl']) if (!config[key]) blockers.push(`${key} is not configured`);
if (!config.privacyApproved) blockers.push('Privacy/operator review is not complete');
if (config.supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.supportEmail)) blockers.push('Support email is invalid');
if (config.backendUrl) {
  try {
    const url = new URL(config.backendUrl);
    if (url.protocol !== 'https:') throw Error('HTTPS required');
    const ready = await fetch(`${config.backendUrl.replace(/\/$/, '')}/ready`, { signal: AbortSignal.timeout(15000) });
    if (!ready.ok) blockers.push(`Backend readiness failed (${ready.status})`);
  } catch { blockers.push('Production backend is unreachable or insecure'); }
}
if (process.argv.includes('--published') && !config.appStoreUrl) blockers.push('A verified App Store listing URL is required after approval');
console.log(blockers.length ? `Release blocked:\n- ${blockers.join('\n- ')}` : 'Configured release services are ready. Store signing, legal facts and device acceptance evidence still require their recorded checks.');
process.exitCode = blockers.length ? 1 : 0;
