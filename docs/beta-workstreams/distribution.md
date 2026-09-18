# Native build and distribution readiness

Updated 2026-09-17 (local time). TF-1 remains **OPEN**. Free Personal Team signing
and installation on the user's iPhone are verified; first launch is waiting on
device-side developer trust. TestFlight delivery has not been verified.
No store submission, EAS build purchase,
Apple enrollment/payment, production deployment, or agreement acceptance was
performed in this task.

## Source and ownership

- Worktree: `/Users/jonathanj/.codex/worktrees/7411/mirra`.
- Private branch: `codex/beta-distribution-2026-09-17`.
- Created clean from `f628b73c09815af4895b744b6682c1a7ee8e1345`, then fast-forwarded
  to assigned baseline `773d35f3e554f8c8353f17c81b7bd847cc9078a1`.
- Distribution code: `13ae5d8` (native Release environment guard, regression
  check, free personal-device instructions).
- Initial build included shared duration helper `b5bb77b` as `404838c` and capture
  `b406afe` as `b32546e`. Integrate the originals only once; these are identical
  cherry-picks. That initial artifact lacked the later import/offline/UI changes;
  the integrated rebuild below supersedes it.
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

## Initial local validation

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
- Preserved artifact: `/private/tmp/mirra-distribution-artifacts/b32546e/Mirra.app`.
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

## Integrated candidate rebuild

- Confirmed the private worktree was clean and fast-forwarded it to exact source
  **`a4b3c14dfaa8fa5950026aae173b901439ad02f1`**. This includes the combined
  capture, import, queue, native Release guard, and backend candidates.
  The primary checkout was not changed.
- **PASS:** local iPhone **Release** rebuild with `-jobs 2`, existing
  `/private/tmp/mirra-distribution-device` cache, and `CODE_SIGNING_ALLOWED=NO`.
  Xcode exited **0**, `BUILD SUCCEEDED`; production environment validation and
  bundling of **1,883 modules** passed. Native dependency versions are unchanged.
  Regenerated machine-path checksum and privacy ordering are excluded from Git.
- Stable artifact copy:
  `/private/tmp/mirra-distribution-artifacts/a4b3c14/Mirra.app`.
  Identity JSON: `/private/tmp/mirra-distribution-artifacts/a4b3c14/build-identity.json`.
  Build log: `/private/tmp/mirra-distribution-integrated-a4b3c14-build.log`.
  Result: `/private/tmp/mirra-distribution-integrated-a4b3c14.xcresult`.
- Verified **arm64**, `com.mirra.app`, **1.0.0 (1)**, SDK `iphoneos26.5`,
  minimum iOS **16.4**, background `audio`, and microphone purpose text.
  Both local artifacts have the same app version, so distinguish them by source
  commit and the hashes below, not version number alone.
- Embedded `main.jsbundle`: **4,871,092 bytes**, intended public Render URL
  confirmed; SHA-256
  `cdd96c87f3505c49c04b321290dbe6ea43da441282b55a8ffcfabffc78c43809`.
  Executable SHA-256:
  `29a13225dd6e6d13c2f6eb3d82b6850e775dad3672d18ca53b6d77d610c3325e`.
- `codesign -d` confirms **unsigned**, and no provisioning profile is embedded.
  Fresh device/signing inventory again found **no devices / 0 valid identities**.
  TF-1 and every physical-device gate remain open.
- The integration task separately reported **44 app tests + TypeScript**,
  **187 backend tests**, and **7 real local PostgreSQL tests** passing for this
  candidate. This task performed the actual native rebuild and artifact checks;
  those other checks were not rerun here.
- The app points at the existing production Render endpoint. Its free 512 MB
  backend still runs the old deployed code; no migration or deployment occurred.
  Building the integrated app does not establish integrated end-to-end behavior.

## Free own-device install and remaining user steps

Follow [the local iPhone instructions](../../app/README.md#free-installation-on-your-own-iphone).
Apple Account sign-in is now complete. The user must complete any further
agreements, connect/unlock/trust the phone, and enable Developer Mode. Then select the
Personal Team with automatic signing, use the **Release** run configuration,
and install. No paid enrollment is required for this route. Apple's Personal
Team provisioning expires after seven days; renew by rebuilding/reinstalling.
The prepared workspace is open in Xcode. Before the connection handoff below,
the device inventory contained no iPhone and no valid local signing identity.

### Connected phone — free Personal Team installation

The user subsequently confirmed the phone was connected. `devicectl` verified
an **iPhone 13 (iPhone14,5), iOS 26.6.2 (23G90)**, paired over USB with an active
tunnel. **Developer Mode was disabled**, so DDI services were unavailable.
The user was asked to enable Developer Mode, restart, unlock and confirm it.
There were still **0 valid signing identities**.

The prepared Xcode command targeted this phone and the existing free Personal
Team, using automatic signing, `-allowProvisioningUpdates` and
`-allowProvisioningDeviceRegistration`. Automatic approval review rejected it
before execution because exact account/device registration and provisioning
access needed explicit user approval; it also noted disabled Developer Mode.
The user was asked to approve free device registration, development certificate,
provisioning profile, signing and installation; that blocked attempt did not run.

The user explicitly approved free signing/install. Xcode created a valid Apple
Development certificate, but Apple rejected `com.mirra.app` as unavailable to
this Personal Team. The user then explicitly approved registering
**`com.mirra.personal.dm85xzns55`** for the same local test candidate. Automatic
review accepted the retry. This is a command-line build override; the shared
project and production bundle ID remain unchanged. Before a future store build,
confirm an available app identifier with the intended distribution team.

- Phone readiness: **Developer Mode enabled**, DDI services available, paired
  iPhone 13 running iOS 26.6.2. No further Developer Mode approval is pending.
- **PASS:** signed iPhone Release build with automatic free Personal Team
  provisioning and `-jobs 2`, app source exactly `a4b3c14` (checkout `1be0a0d`
  differs only in documentation). Build log:
  `/private/tmp/mirra-distribution-personal-unique-a4b3c14-build.log`;
  result `/private/tmp/mirra-distribution-personal-unique-a4b3c14.xcresult`.
- Signed artifact:
  `/private/tmp/mirra-distribution-artifacts/a4b3c14-personal/Mirra.app`;
  sanitized identity JSON beside it. Bundle ID
  `com.mirra.personal.dm85xzns55`, version **1.0.0 (1)**, minimum iOS **16.4**.
- **PASS:** `codesign --verify --deep --strict`; embedded development profile
  includes this exact iPhone and matches the app identifier. Profile expires
  **2026-09-25 01:09:36 UTC**; rebuild/reinstall to renew free provisioning.
  No private key or full provisioning profile was printed or committed.
- Production JS is unchanged from the integrated unsigned artifact:
  **4,871,092 bytes**, SHA-256
  `cdd96c87f3505c49c04b321290dbe6ea43da441282b55a8ffcfabffc78c43809`.
  Signed executable SHA-256:
  `f7c8461ea5e46b6406d67b5e969e139e6e82189ccdef59e964c0d63b62de0b68`.
- **PASS:** `devicectl device install app` exited 0 and confirmed the installed
  local bundle ID at **2026-09-18 01:11 UTC**. Log/JSON:
  `/private/tmp/mirra-distribution-install-a4b3c14.{log,json}`.
- **OPEN:** launch attempt was denied by iOS with a security message covering
  signature, entitlements, or an untrusted profile. Local signature/profile
  checks passed. The user was directed to **Settings → General → VPN & Device
  Management → Developer App → their Apple Account → Trust/Verify App**, then
  to open Mirra. Launch log:
  `/private/tmp/mirra-distribution-launch-a4b3c14.log`.
  No successful launch, disconnected cold launch, auth restoration, recording,
  or TestFlight gate is claimed from the install alone.

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
