# vCard Editor

`vCard Editor` is a macOS-first desktop app for opening, editing, validating and safely saving `.vcf` files. It is built with `Tauri + React + TypeScript` and focuses on a clean UI, conservative roundtrips and practical day-to-day contact editing in both single-contact and batch workflows.

## Release status

- Current version: `1.0.0`
- License: `MIT`
- Primary target: macOS
- Release artifacts: `.app` and `.dmg`
- Latest release location: GitHub Releases for this repository

Current release builds are functional but unsigned and not notarized. For public macOS distribution without Gatekeeper warnings, signing and notarization secrets still need to be added later.

## What it supports

- Two editing modes:
  - `Single`: open and edit one vCard file with a structured inspector and live raw preview
  - `Batch`: import many vCards, inspect one item in full or apply a structured patch to many selected files
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

## Batch workflow

- Import multiple `.vcf` files directly or load all `.vcf` files from one folder
- Search, sort and select files from the batch table
- Edit one selected item with the same full inspector used in single mode
- Select multiple valid items to open the batch patch panel
- Preview is required before apply, so the write plan stays explicit
- Two write strategies are supported:
  - `In-place with backups`
  - `Output directory`
- In-place batch writes create timestamped sibling backup files before the target file is overwritten
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
- Batch folder import is intentionally non-recursive in the current implementation.
- The editor is macOS-first; Linux and Windows are not part of the supported release target right now.
- Rare standard fields without dedicated UI are preserved as raw properties instead of being edited directly.
