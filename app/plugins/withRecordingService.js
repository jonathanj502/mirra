const { withAndroidManifest, withMainApplication, withAppDelegate, withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

module.exports = function withRecordingService(config) {
  config = withAppDelegate(config, config => {
    const marker = '// Keep private pending audio out of device backups.';
    if (!config.modResults.contents.includes(marker)) {
      const anchor = 'let delegate = ReactNativeDelegate()';
      if (!config.modResults.contents.includes(anchor)) throw new Error('Audio backup protection: unexpected AppDelegate template');
      config.modResults.contents = config.modResults.contents.replace(anchor, `${marker}
    if var documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try? documents.setResourceValues(values)
    }
    ${anchor}`);
    }
    return config;
  });
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
    const drawable = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/drawable');
    fs.mkdirSync(drawable, { recursive: true });
    fs.writeFileSync(path.join(drawable, 'ic_recording.xml'), '<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24"><path android:fillColor="#FFFFFFFF" android:pathData="M12,2a3,3 0,0 0,-3 3v7a3,3 0,0 0,6 0V5a3,3 0,0 0,-3 -3M5,10v2a7,7 0,0 0,6 6.93V22h2v-3.07A7,7 0,0 0,19 12v-2h-2v2a5,5 0,0 1,-10 0v-2Z"/></vector>');
    return config;
  }]);
};
