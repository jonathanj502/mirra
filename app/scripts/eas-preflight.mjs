import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.env.EAS_BUILD_PROFILE === 'production') {
  execFileSync(process.execPath, [fileURLToPath(new URL('../../website/release-check.mjs', import.meta.url))], { stdio: 'inherit' });
}
