# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

- Added Ubuntu 22.04 CI verification alongside the existing macOS checks.
- Added Ubuntu 22.04 AppImage packaging to the tag-driven GitHub release workflow.
- Added Linux production documentation and a dedicated Ubuntu 22.04 smoke checklist.
- Updated product metadata and support documentation from macOS-only wording to macOS plus Ubuntu 22.04.
- Added Windows CI verification alongside macOS and Ubuntu.
- Added Windows 10/11 x64 NSIS packaging to the tag-driven GitHub release workflow.
- Added Windows production documentation and a dedicated Windows smoke checklist.
- Added first-pass Windows installer configuration with WebView2 download bootstrapper support.
- Added a cross-platform no-bundle Tauri compile gate in CI to catch desktop build regressions before release packaging.

## 1.1.0 - 2026-03-23

- Added the full Batch feature set for release use:
  - multi-file and folder import
  - batch draft creation with numbered file generation
  - structured batch patching with mandatory preview before apply
  - output-directory export mode and in-place writes with backups
- Added the Power user table with inline editing for the most important contact fields:
  - formatted name, organization, title and role
  - email, phone and website
  - virtualization for larger batch sets
- Reworked the interface toward a cleaner macOS-style layout with reduced visual noise and better large-screen behavior.
- Added a custom date picker used in both the single editor and batch patch flows.
- Hardened batch release edge cases with broader UI regression coverage for unreadable imports, filtered bulk selection, creator normalization and batch date editing.
- Added a manual batch release checklist for the real Tauri smoke pass before merge or public release.

## 1.0.0 - 2026-03-23

- Shipped the first stable macOS-first desktop release of vCard Editor.
- Added a modern single-file editor for `.vcf` contacts with live raw preview and safe save flows.
- Added support for photos, business-card fields, birthdays, anniversaries and instant-messaging URIs.
- Added conservative unknown-property preservation, Apple grouped labels and broader import edge-case coverage.
- Added managed `UID`, `REV` and `PRODID` metadata handling.
- Added CI verification and a tag-driven GitHub Actions release pipeline for macOS bundles.
