# Windows Release Checklist

Use this checklist before merging Windows support into `main` or shipping a release that includes the Windows x64 NSIS installer.

## Automated Gate

- Run `npm run verify`.
- Confirm CI passes on `macos-latest`, `ubuntu-22.04`, and `windows-latest`.
- Confirm the release workflow includes a Windows `nsis` job.

## Windows 10/11 x64 Smoke Run

Run these checks on both Windows 10 x64 and Windows 11 x64 where possible.

1. Installation:
   - Launch the NSIS installer successfully.
   - Confirm the installer runs in current-user mode without unexpected elevation prompts.
   - Confirm the installer icon and app metadata look correct.

2. WebView2 runtime:
   - Install on a machine that already has WebView2 and confirm the app launches directly.
   - Install on a machine without WebView2, with internet access available, and confirm the download bootstrapper path works.
   - Confirm the first launch does not fail with missing WebView runtime errors.

3. Native dialogs and file access:
   - Open one `.vcf` file.
   - Save a new `.vcf` file.
   - Choose an output directory.
   - Confirm Windows-style paths behave correctly in labels and file operations.

4. Batch flows:
   - Import multiple `.vcf` files.
   - Import a folder of `.vcf` files.
   - Preview and apply an in-place batch update.
   - Confirm `.bak.vcf` backups are created.
   - Preview and apply an output-directory export.

5. Error handling and editing:
   - Include one unreadable or intentionally broken `.vcf`.
   - Confirm it stays visible with an error message and is skipped during preview/apply.
   - Edit a single contact and save it.
   - Edit several contacts in the power-user table.
   - Use the custom date picker in both single and batch patch flows.

6. Desktop behavior:
   - Verify drag and drop from Windows Explorer if it behaves reliably.
   - Reopen the app after install and after a relaunch.
   - Uninstall the app and do a basic post-uninstall cleanup sanity check.

## Merge Gate

- No Windows-specific packaging, WebView2, or file-access issues remain.
- The Windows smoke run covers install, launch, batch, export, and uninstall flows.
- The Windows x64 NSIS artifact is present in the release workflow output.
