# Native build and distribution readiness

Updated 2026-09-17. TF-1 remains **OPEN**. No signed iPhone installation or
TestFlight delivery has been verified. No store submission, EAS build purchase,
Apple enrollment/payment, production deployment, or agreement acceptance was
performed in this task.

## Source and ownership

- Worktree: `/Users/jonathanj/.codex/worktrees/7411/mirra`.
- Private branch: `codex/beta-distribution-2026-09-17`.
- Created clean from `f628b73c09815af4895b744b6682c1a7ee8e1345`, then fast-forwarded
  to assigned baseline `773d35f3e554f8c8353f17c81b7bd847cc9078a1`.
- Distribution code: `13ae5d8` (native Release environment guard, regression
  check, free personal-device instructions).
- Build includes shared duration helper `b5bb77b` as `404838c` and capture
  `b406afe` as `b32546e`. Integrate the originals only once; these are identical
  cherry-picks. Later import/offline/UI candidates are not in this artifact.
- Only distribution files and this evidence file are authored here; capture
  changes belong to the device task.

## Configuration and toolchain evidence

- Xcode **26.6 (17F113)** selected at `/Applications/Xcode.app/Contents/Developer`.
  Initial first-launch check exited 69. Installed Xcode system components;
  subsequent `xcodebuild -checkFirstLaunchStatus` exited 0. iOS platform download
  completed through Xcode: iOS 26.5.1 platform and iOS 26.5 Simulator. No
  license/Apple agreement was accepted by Codex.
- `security find-identity -v -p codesigning`: **0 valid identities**.
  Xcode Settings → Apple Accounts initially showed **Add Apple Account**.
  The user subsequently signed in; Xcode now shows a **Personal Team**.
  No paid membership or distribution credentials verified.
- `xcrun devicectl list devices`: **No devices found** at initial preparation.
- EAS CLI 24.6.0 read-only account/project check confirmed `@jjiang25/mirra`,
  UUID `20253166-6402-4548-bb4a-5084bcc0dc03`. No EAS build was requested.
- Checked-in native project has exactly one native app target, **Mirra**, with
  an empty entitlements dictionary. No extension target was removed or generated.
  Background audio and the microphone purpose string remain in native Info.plist.
- Bundle ID `com.mirra.app`, marketing version **1.0.0**, local build **1**;
  minimum iOS **16.4**. Release loads `main.jsbundle` from the app bundle.
- Reused the identical package-lock dependency tree by copying it into this
  worktree. Restored **108 pods / 109 Podfile dependencies**, preserving the
  checked-in SDK 57 / React Native 0.86.3 versions; no prebuild was run.
  `pod install --deployment` rejected only ExpoModulesCore's checksum: its
  precompiled podspec embeds the absolute checkout path of a local tarball.
  Ordinary `pod install` restores it in the new path. This checksum is local
  installation metadata, not an Expo version change. Generated checksum and
  privacy-manifest ordering changes are excluded from the committed candidate;
  rerun `pod install` before the next native build in this worktree.
- Ignored public `.env.production.local` copied from the authorized existing
  checkout. Production validation passed; backend is
  `https://mirra-backend-wp2b.onrender.com`. Supabase values were not printed or
  committed. This production service still runs the older deployed candidate;
  pointing a new app at it does not deploy the 1400-second server changes.

## Local validation

- **PASS:** 32 app tests and `npm run typecheck` after including the helper and
  capture commits above.
- **PASS:** `plutil -lint` on the native project and `git diff --check`.
- **PASS:** native bundle-phase regression executes the actual Xcode shell phase
  with invalid local configuration. Release refuses it even when
  `SKIP_BUNDLING=1`; Debug retains its development behavior.
- **PASS:** `npm run export:ios:production`, 4,870,206-byte Hermes bundle:
  `app/dist/_expo/static/js/ios/entry-c92814a7fc878737c06f30aecefbebee.hbc`.
  Binary inspection confirmed the intended public Render URL is embedded.
  Log: `/private/tmp/mirra-distribution-export.log`.
- **PASS:** local unsigned iPhone **Release** compilation, Xcode exit 0 and
  `BUILD SUCCEEDED`. The first attempt stopped before compilation while the
  platform was downloading; the completed attempt passed all native compilation,
  linking, production configuration validation and bundling (1,883 JS modules).
  Log: `/private/tmp/mirra-distribution-device-build.log`.
  Result: `/private/tmp/mirra-distribution-device-ready.xcresult`.
- Artifact: `/private/tmp/mirra-distribution-device/Build/Products/Release-iphoneos/Mirra.app`.
  Built source `b32546e`, version **1.0.0 (1)**, bundle ID `com.mirra.app`,
  arm64 iPhone executable, SDK `iphoneos26.5`, minimum iOS **16.4**.
  Native bundle retains background `audio` and the microphone purpose string.
  Embedded `main.jsbundle` is **4,870,179 bytes** and contains the intended
  Render URL; SHA-256
  `daf85b60244176f9698429cc5a8bb664ffc1d3d43b22980379f1d94c2f70bc3c`.
  No embedded provisioning profile; `codesign -d` confirms it is **unsigned**.
  It is not an installable device build or proof of successful app launch.
- Preserved the native build cache at `/private/tmp/mirra-distribution-device`.
  The Mac has 8 GiB RAM; use `-jobs 2` for subsequent Xcode builds to reduce
  compile-time resource pressure. No unrelated process was stopped.

## Free own-device install and remaining user steps

Follow [the local iPhone instructions](../../app/README.md#free-installation-on-your-own-iphone).
Apple Account sign-in is now complete. The user must complete any further
agreements, connect/unlock/trust the phone, and enable Developer Mode. Then select the
Personal Team with automatic signing, use the **Release** run configuration,
and install. No paid enrollment is required for this route. Apple's Personal
Team provisioning expires after seven days; renew by rebuilding/reinstalling.
The prepared workspace is open in Xcode. Final observed device inventory still
contained no iPhone and no valid local signing identity.

Until an installed app is cold-launched with the Mac disconnected, this does
not prove standalone launch. Capture, permission recovery, screen-lock behavior,
auto-stop at 1400 seconds (including interruptions), imports, auth restoration,
and offline queue checks remain with their respective workstreams. A Personal
Team install supplies physical-device evidence but cannot close TF-1.

## TestFlight work still required

1. User chooses when to enroll in the paid Apple Developer Program and completes
   membership and agreements. No payment is authorized here.
2. Configure the correct Apple team, register the app's bundle ID, create the
   App Store Connect app record, and establish distribution signing credentials.
3. After integration/review and explicit build direction, build the exact
   candidate with `eas build --platform ios --profile production` (or archive it
   locally). Review current EAS quota/pricing before any paid build. EAS remote
   versioning and production auto-increment are already configured.
4. With explicit upload direction, submit the specific signed build to App Store
   Connect, complete required metadata/compliance information, and wait for Apple
   processing. Invite testers only when authorized; external testers may require
   beta review.
5. Install the processed build using TestFlight and perform the actual TF-1
   cold-launch test plus the remaining acceptance checks. Record the build ID,
   device/iOS version and results before changing any gate status.

Sources: [Apple Personal Team limits](https://developer.apple.com/help/account/basics/about-your-developer-account),
[Apple device running guide](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices),
[Apple TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview),
[Expo local builds](https://docs.expo.dev/guides/local-app-overview/).
