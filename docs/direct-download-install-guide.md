# Direct Download Install Guide

This project currently uses a zero-cost direct-download release path for macOS and Windows. That means the builds are installable, but platform trust warnings are expected.

## Windows 10/11

The Windows release artifact is an unsigned `NSIS` installer.

1. Download the `.exe` from the GitHub release page.
2. If Windows shows `Windows protected your PC`, click `More info`.
3. Click `Run anyway`.
4. Complete the installer in current-user mode.
5. Launch the app normally from the Start menu or the install location.

Notes:

- SmartScreen warnings are expected for public unsigned builds.
- The installer uses the WebView2 download bootstrapper, so machines without WebView2 need internet access during installation.

## macOS

The macOS release artifacts are direct-download `DMG` bundles. They use ad-hoc signing for compatibility, but they are not notarized by Apple.

1. Download the `.dmg` from the GitHub release page.
2. Open the `DMG` and drag `vCard Editor.app` into `Applications`.
3. On first launch, if macOS blocks the app, use `Right-click -> Open`.
4. If that still does not open the app, go to `System Settings -> Privacy & Security` and choose `Open Anyway`.
5. Launch the app again.

Notes:

- A first-launch Gatekeeper warning is expected because the app is not notarized.
- This is a manual trust step, not a sign that the download is broken.
