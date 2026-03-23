# Linux Release Checklist

Use this checklist before merging Linux support into `main` or shipping a release that includes the Ubuntu 22.04 AppImage artifact.

## Automated Gate

- Run `npm run verify`.
- Confirm CI passes on both `macos-latest` and `ubuntu-22.04`.
- Confirm the release workflow includes a Linux `AppImage` job.

## Ubuntu 22.04 Smoke Run

Run these checks on Ubuntu 22.04 with the built AppImage or through `npm run tauri dev`.

1. Startup:
   - Launch the app successfully.
   - If testing the AppImage directly, make it executable first with `chmod +x`.
   - Confirm the window opens without missing-runtime errors.

2. Native dialogs and file access:
   - Open one `.vcf` file.
   - Save a new `.vcf` file.
   - Choose an output directory.
   - Confirm scoped file access behaves as expected.

3. Batch import:
   - Import multiple `.vcf` files.
   - Import a folder of `.vcf` files.
   - Confirm sorting and selection behave the same as on macOS.

4. Batch apply:
   - Preview and apply an in-place batch update.
   - Confirm `.bak.vcf` backups are created.
   - Preview and apply an output-directory export.
   - Confirm originals remain untouched in output-directory mode.

5. Error handling:
   - Include one unreadable or intentionally broken `.vcf`.
   - Confirm it stays visible with an error message.
   - Confirm it is skipped during preview and apply.

6. Editing flows:
   - Edit a single contact and save it.
   - Edit several contacts in the power-user table.
   - Use the custom date picker in both single and batch patch flows.

7. Desktop behavior:
   - Verify drag and drop if it behaves reliably in the target desktop environment.
   - Confirm the AppImage launches repeatedly and can reopen files after restart.

## Merge Gate

- No Linux-specific file access or packaging issues remain.
- The Ubuntu 22.04 smoke run covers single, batch, export and backup flows.
- The AppImage artifact is present in the release workflow output.
