const { withAndroidManifest, withAppDelegate, withXcodeProject } = require('expo/config-plugins');

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
  config = withXcodeProject(config, config => {
    const phases = Object.values(config.modResults.hash.project.objects.PBXShellScriptBuildPhase);
    const phase = phases.find(value => value.name === '"Bundle React Native code and images"');
    if (!phase) throw new Error('Production configuration: missing bundle phase');
    let script = JSON.parse(phase.shellScript);
    const marker = '# Validate production endpoints before Release bundling.';
    if (!script.includes(marker)) {
      const anchor = '`"$NODE_BINARY" --print';
      if (!script.includes(anchor)) throw new Error('Production configuration: unexpected bundle script');
      script = script.replace(anchor, `${marker}
if [[ "$CONFIGURATION" != *Debug* ]]; then
  export NODE_ENV=production
  unset SKIP_BUNDLING
  (cd "$PROJECT_ROOT" && "$NODE_BINARY" scripts/check-production-env.cjs) || exit 1
fi

${anchor}`);
      phase.shellScript = JSON.stringify(script);
    }
    return config;
  });
  return config;
};
