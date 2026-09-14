const { withAndroidManifest, withMainApplication, withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

module.exports = function withRecordingService(config) {
  config = withAndroidManifest(config, config => {
    const application = config.modResults.manifest.application[0];
    application.$['android:allowBackup'] = 'false';
    application.$['android:usesCleartextTraffic'] = 'false';
    application.service ??= [];
    if (!application.service.some(service => service.$['android:name'] === '.RecordingForegroundService')) {
      application.service.push({ $: {
        'android:name': '.RecordingForegroundService',
        'android:exported': 'false',
        'android:foregroundServiceType': 'microphone',
      } });
    }
    return config;
  });
  config = withMainApplication(config, config => {
    if (!config.modResults.contents.includes('add(RecordingServicePackage())')) {
      const anchor = 'PackageList(this).packages.apply {';
      if (!config.modResults.contents.includes(anchor)) throw new Error('Recording service registration: unexpected MainApplication template');
      config.modResults.contents = config.modResults.contents.replace(anchor, `${anchor}\n              add(RecordingServicePackage())`);
    }
    return config;
  });
  return withDangerousMod(config, ['android', async config => {
    const target = path.join(config.modRequest.platformProjectRoot, 'app/src/main/java', config.android.package.replaceAll('.', '/'));
    fs.mkdirSync(target, { recursive: true });
    for (const name of ['RecordingForegroundService.kt', 'RecordingServiceModule.kt', 'RecordingServicePackage.kt']) {
      const source = fs.readFileSync(path.join(__dirname, 'android', name), 'utf8');
      fs.writeFileSync(path.join(target, name), source.replace('package com.mirra.app', `package ${config.android.package}`));
    }
    return config;
  }]);
};
