const { withAndroidManifest, withAppDelegate } = require('expo/config-plugins');

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
    return config;
  });
  return config;
};
