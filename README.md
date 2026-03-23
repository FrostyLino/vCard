# vCard Editor

`vCard Editor` is a desktop app for macOS, Ubuntu and Windows for opening, editing, validating and safely saving `.vcf` files. It is built with `Tauri + React + TypeScript` and focuses on a clean UI, conservative roundtrips and practical day-to-day contact editing in both single-contact and batch workflows.

## Release status

- Current version: `1.1.0`
- License: `MIT`
- Supported platforms in this branch: macOS, Ubuntu 22.04 and Windows 10/11 x64
- Release workflow artifacts: `.app`, `.dmg`, `.AppImage` and Windows NSIS `.exe`
- Latest release location: GitHub Releases for this repository

The app is feature-complete for production use on macOS, Ubuntu 22.04 and Windows 10/11 x64 and ships with automated verification plus manual smoke checklists for the real Tauri runtime. Current macOS builds are still unsigned and not notarized, and first-pass Windows installers are unsigned and may trigger SmartScreen warnings.

## Production readiness

- Automated gate: `npm run verify`
- Cross-platform desktop compile gate in CI: `npm run verify:desktop`
- Manual release gate: [`docs/batch-release-checklist.md`](docs/batch-release-checklist.md)
- Manual Linux gate: [`docs/linux-release-checklist.md`](docs/linux-release-checklist.md)
- Manual Windows gate: [`docs/windows-release-checklist.md`](docs/windows-release-checklist.md)
- Native release workflow: tag push via `.github/workflows/release.yml`
- Supported release platforms: macOS, Ubuntu 22.04 and Windows 10/11 x64
- Safety model:
  - save validation blocks broken single-file writes
  - batch preview is mandatory before apply
  - in-place batch writes create timestamped backups
  - unreadable batch items are preserved as visible errors and excluded from writes

## What it supports

- Two editing modes:
  - `Single`: open and edit one vCard file with a structured inspector and live raw preview
  - `Batch`: import many vCards, inspect one item in full, patch many selected items, or create/export new drafts
- Open and save exactly one vCard per file
- Read and write `vCard 3.0` and `4.0`
- Modern structured editing UI with live raw preview
- Contact photo import and roundtrip-safe serialization
- Custom integrated date picker for birthdays and anniversaries
- Business-card fields such as:
  - `FN`, `N`, `NICKNAME`
  - `ORG`, `TITLE`, `ROLE`
  - `EMAIL`, `TEL`, `URL`, `IMPP`
  - `ADR`, `NOTE`
  - `BDAY`, `ANNIVERSARY`
- Managed metadata:
  - `UID`
  - `REV`
  - `PRODID`
- Apple grouped labels via `itemX.X-ABLabel`
- Conservative preservation of unknown properties during roundtrip editing

## Batch workflow

- Import multiple `.vcf` files directly or load all `.vcf` files from one folder
- Search, sort and select files from the batch table
- Create numbered batch drafts directly inside the workspace
- Edit one selected item with the same full inspector used in single mode
- Select multiple valid items to open the batch patch panel
- Use the `Power user table` for fast inline editing of:
  - formatted name
  - organization
  - title
  - role
  - email
  - phone
  - website
- Preview is required before apply, so the write plan stays explicit
- Two write strategies are supported:
  - `In-place with backups`
  - `Output directory`
- In-place batch writes create timestamped sibling backup files before the target file is overwritten
- Draft items can be promoted into real file-backed batch items through export
- Files that cannot be parsed or still contain blocking validation errors are skipped instead of being silently rewritten

## Validation and safety

- `FN` is required before save
- `vCard 3.0` exports always include `N`, even if it has to be synthesized from `FN`
- Emails, URLs, dates and instant-messaging URIs are validated
- Empty optional rows are warned about before save
- Unknown or unsupported fields are preserved instead of dropped
- Import warnings remain visible during editing
- Batch apply never bypasses preview
- Unreadable batch items are tracked explicitly and excluded from writes

## Local development

Requirements:

- Node.js and npm
- Rust toolchain via `rustup`
- Platform prerequisites:
  - macOS: Apple Command Line Tools
  - Ubuntu 22.04:
    - `sudo apt-get update`
    - `sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libgtk-3-dev libappindicator3-dev librsvg2-dev patchelf libfuse2`
  - Windows 10/11 x64:
    - Microsoft Visual Studio C++ Build Tools
    - MSVC toolchain support through the standard Rust Windows toolchain
    - WebView2 runtime if you are running the app outside the installer flow

Install and run:

```bash
npm ci
npm run tauri dev
```

## Verification

Run the full local verification suite:

```bash
npm run verify
```

Run the no-bundle desktop compile used by CI to validate the real Tauri app build on the current platform:

```bash
npm run verify:desktop
```

Run the manual batch smoke checklist before shipping batch workflow changes or pushing a public release:

```bash
cat docs/batch-release-checklist.md
```

Run the Ubuntu 22.04 Linux smoke checklist before merging Linux support or cutting a release that includes AppImage artifacts:

```bash
cat docs/linux-release-checklist.md
```

Run the Windows smoke checklist before merging Windows support or cutting a release that includes the NSIS installer:

```bash
cat docs/windows-release-checklist.md
```

Build a local release bundle:

```bash
npm run tauri build
```

On Ubuntu 22.04, AppImage bundles are produced by the same command. The resulting file may need `chmod +x` before launch outside the build environment.
On Windows, the same command produces the NSIS installer. The first-pass installer uses the WebView2 download bootstrapper, so machines without WebView2 need internet access during installation.

## Release process

This repository includes:

- `.github/workflows/ci.yml` for macOS, Ubuntu 22.04 and Windows verification on pushes and pull requests, including a no-bundle Tauri compile on each supported OS
- `.github/workflows/release.yml` for tag-driven macOS bundles, Ubuntu 22.04 AppImage builds and Windows NSIS installers

To cut a release:

```bash
git checkout main
git pull
git tag v1.1.0
git push origin v1.1.0
```

That tag triggers the release workflow, which builds macOS bundles, the Ubuntu 22.04 AppImage, and the Windows x64 NSIS installer and creates or updates the GitHub release automatically.

## Scope limits

- The app intentionally supports only one `BEGIN:VCARD ... END:VCARD` block per file.
- Batch folder import is intentionally non-recursive in the current implementation.
- Official Linux support is currently limited to Ubuntu 22.04 with AppImage as the release artifact.
- Official Windows support is currently limited to Windows 10/11 x64 with NSIS as the installer format.
- Windows installers are currently unsigned; SmartScreen warnings are expected until signing is added later.
- Rare standard fields without dedicated UI are preserved as raw properties instead of being edited directly.
