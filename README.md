# vCard Editor

A local macOS-first editor for single `.vcf` files built with `Tauri + React + TypeScript`.

## Current v1 scope

- Open one `.vcf` file at a time
- Edit core contact and business-card fields in a modern desktop UI
- Show live raw vCard preview
- Validate blocking issues before save
- Preserve unknown properties during roundtrip serialization
- Support vCard `3.0` and `4.0`
- Support contact photos, dates, instant-messaging URIs and managed metadata

## Local development

Requirements:

- Node.js and npm
- Rust toolchain via `rustup`
- Apple Command Line Tools on macOS

Commands:

```bash
npm install
npm run tauri dev
```

## Quality checks

```bash
npm test
npm run build
cd src-tauri && cargo check
```

## Notes

- The app intentionally supports only one vCard entry per file in v1.
- Unknown properties are preserved and written back after known fields.
- New drafts generate managed `UID`, `REV` and `PRODID` values automatically.
- Drag-and-drop support is wired through Tauri window events.
