# vCard Editor

`vCard Editor` is a macOS-first desktop app for opening, editing, validating and safely saving a single `.vcf` file at a time. It is built with `Tauri + React + TypeScript` and focuses on a clean UI, conservative roundtrips and practical day-to-day contact editing.

## Release status

- Current version: `1.0.0`
- License: `MIT`
- Primary target: macOS
- Release artifacts: `.app` and `.dmg`
- Latest release location: GitHub Releases for this repository

Current release builds are functional but unsigned and not notarized. For public macOS distribution without Gatekeeper warnings, signing and notarization secrets still need to be added later.

## What it supports

- Open and save exactly one vCard per file
- Read and write `vCard 3.0` and `4.0`
- Modern structured editing UI with live raw preview
- Contact photo import and roundtrip-safe serialization
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

## Validation and safety

- `FN` is required before save
- `vCard 3.0` exports always include `N`, even if it has to be synthesized from `FN`
- Emails, URLs, dates and instant-messaging URIs are validated
- Empty optional rows are warned about before save
- Unknown or unsupported fields are preserved instead of dropped
- Import warnings remain visible during editing

## Local development

Requirements:

- Node.js and npm
- Rust toolchain via `rustup`
- Apple Command Line Tools on macOS

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

Build a local release bundle:

```bash
npm run tauri build
```

## Release process

This repository includes:

- `.github/workflows/ci.yml` for verification on pushes and pull requests
- `.github/workflows/release.yml` for tag-driven macOS release builds

To cut a release:

```bash
git checkout main
git pull
git tag v1.0.0
git push origin v1.0.0
```

That tag triggers the release workflow, which builds macOS bundles and creates the GitHub release automatically.

## Scope limits

- The app intentionally supports only one `BEGIN:VCARD ... END:VCARD` block per file.
- The editor is macOS-first; Linux and Windows are not part of the supported release target right now.
- Rare standard fields without dedicated UI are preserved as raw properties instead of being edited directly.
