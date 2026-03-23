# vCard Editor

`vCard Editor` is a macOS-first desktop app for opening, editing, validating and safely saving `.vcf` files. It is built with `Tauri + React + TypeScript` and focuses on a clean UI, conservative roundtrips and practical day-to-day contact editing in both single-contact and batch workflows.

## Release status

- Current version: `1.1.0`
- License: `MIT`
- Primary target: macOS
- Release artifacts: `.app` and `.dmg`
- Latest release location: GitHub Releases for this repository

The app is feature-complete for production use on macOS and ships with automated verification plus a manual release checklist for the real Tauri runtime. Current release builds are still unsigned and not notarized, so public distribution without Gatekeeper warnings requires signing and notarization to be added separately.

## Production readiness

- Automated gate: `npm run verify`
- Manual release gate: [`docs/batch-release-checklist.md`](docs/batch-release-checklist.md)
- Native release workflow: tag push via `.github/workflows/release.yml`
- Supported release platform: macOS
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

Run the manual release smoke checklist before merging the Batch feature to `main` or pushing a public release:

```bash
open docs/batch-release-checklist.md
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
git tag v1.1.0
git push origin v1.1.0
```

That tag triggers the release workflow, which builds macOS bundles and creates the GitHub release automatically.

## Scope limits

- The app intentionally supports only one `BEGIN:VCARD ... END:VCARD` block per file.
- Batch folder import is intentionally non-recursive in the current implementation.
- The editor is macOS-first; Linux and Windows are not part of the supported release target right now.
- Rare standard fields without dedicated UI are preserved as raw properties instead of being edited directly.
