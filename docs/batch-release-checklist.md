# Batch Release Checklist

Use this checklist before shipping batch workflow changes or pushing a public release.

## Automated Gate

- Run `npm test`.
- Run `npm run verify`.
- Confirm the working tree only contains the intended release-hardening changes.

## Native Tauri Smoke Run

Run these checks in the actual desktop app via `npm run tauri dev` on macOS.

1. Import files:
   - Add at least two valid `.vcf` files.
   - Add one unreadable or intentionally broken `.vcf`.
   - Confirm the unreadable row stays visible with an error message.
   - Confirm valid rows remain editable and selectable.

2. Folder import:
   - Open a folder with multiple `.vcf` files.
   - Confirm the imported rows appear once and stay sorted predictably.

3. Batch creator:
   - Create drafts with the default values.
   - Try invalid `count` / `start index` values such as `0` and confirm preview and creation normalize safely.
   - Export the drafts to an output folder.
   - Confirm exported drafts adopt their new file-backed paths.

4. Batch patch:
   - Select multiple valid files.
   - Change a shared field such as `Role`.
   - Use the custom `Birthday` and `Anniversary` pickers.
   - Run Preview first, then Apply.
   - In `in-place` mode, confirm `.bak.vcf` backups are created.

5. Output directory mode:
   - Export imported files to a separate output directory.
   - Confirm originals stay untouched.
   - Confirm no backup files are created in output-directory mode.

6. Power user table:
   - Edit `Formatted name`, `Organization`, `Title`, `Role`, `Email`, `Phone`, and `Website`.
   - Use search plus `Select visible valid files`.
   - Confirm only the filtered subset is patched or written.

7. Large batch responsiveness:
   - Import at least 100 to 200 `.vcf` files.
   - Scroll the Power user table.
   - Edit visible rows while scrolling and searching.
   - Confirm there is no obvious UI jank or stalled interaction.

## Merge Gate

- No known P1 or P2 Batch issues remain.
- No unexplained write-path behavior remains.
- Native dialogs and scoped filesystem access behave as expected.
- The smoke run covers both `in-place` and `output-directory` flows.
