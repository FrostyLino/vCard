import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm, message } from "@tauri-apps/plugin-dialog";
import "./App.css";
import {
  createEmptyAddressValue,
  createEmptyContactValue,
  createEmptyDocument,
  ensureManagedMetadata,
  parseVcf,
  serializeVcf,
  touchManagedMetadata,
  validateVCardDocument,
  type AddressValue,
  type ContactValue,
  type PhotoValue,
  type VCardDocument,
} from "./lib/vcard";
import {
  buildBatchPreviewSummary,
  createBatchItem,
  createEmptyBatchPatch,
  createFailedBatchItem,
  getBatchItemSerialized,
  getBatchItemValidationIssues,
  isBatchItemDirty,
  isBatchPatchDirty,
  type BatchItem,
  type BatchPatch,
  type BatchPreviewSummary,
  type BatchWriteMode,
  type ListPatchMode,
  type ScalarPatchMode,
} from "./lib/batch";
import {
  chooseOutputDirectory,
  getPathLabel,
  listVcfFilesInDirectory,
  openManyVcf,
  openVcf,
  openVcfFolder,
  readVcfFile,
  saveVcfAs,
  writeVcfFile,
} from "./lib/file";
import {
  AddressSection,
  ContactSection,
  DocumentForm,
  DocumentInsightsPanel,
  FieldGroup,
  SectionCard,
  type DocumentEditorController,
} from "./components/DocumentEditor";

interface EditorSession {
  document: VCardDocument;
  sourcePath: string | null;
  savedSnapshot: string;
  parseWarnings: string[];
}

interface BatchWorkspace {
  items: BatchItem[];
  selectedIds: string[];
  search: string;
  patch: BatchPatch;
  preview: BatchPreviewSummary | null;
  writeMode: BatchWriteMode;
  outputDirectory: string | null;
}

type WorkspaceMode = "single" | "batch";
type PhotoTarget =
  | { kind: "single" }
  | { kind: "batch-item"; itemId: string }
  | { kind: "batch-patch" }
  | null;

function App() {
  const [mode, setMode] = useState<WorkspaceMode>("single");
  const [session, setSession] = useState<EditorSession | null>(null);
  const [batch, setBatch] = useState<BatchWorkspace>(createEmptyBatchWorkspace());
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState(
    "Open a .vcf file or start with a blank card.",
  );
  const [dragActive, setDragActive] = useState(false);
  const [photoTarget, setPhotoTarget] = useState<PhotoTarget>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  const serializedDocument = session ? serializeVcf(session.document) : "";
  const validationIssues = session ? validateVCardDocument(session.document) : [];
  const blockingIssues = validationIssues.filter((issue) => issue.level === "error");
  const isDirty = session ? serializedDocument !== session.savedSnapshot : false;

  const visibleBatchItems = useMemo(
    () => batch.items.filter((item) => matchesBatchSearch(item, batch.search)),
    [batch.items, batch.search],
  );
  const selectedBatchItems = batch.items.filter((item) => batch.selectedIds.includes(item.id));
  const selectedValidBatchItems = selectedBatchItems.filter((item) => item.document);
  const selectedInvalidBatchItems = selectedBatchItems.filter((item) => !item.document);
  const batchHasDirtyItems = batch.items.some(isBatchItemDirty);
  const batchHasPendingPatch =
    selectedValidBatchItems.length > 1 && isBatchPatchDirty(batch.patch);
  const batchHasUnsavedWork = batchHasDirtyItems || batchHasPendingPatch;

  const modeRef = useRef(mode);
  const hasUnsavedWorkRef = useRef(false);

  useEffect(() => {
    modeRef.current = mode;
    hasUnsavedWorkRef.current = mode === "single" ? isDirty : batchHasUnsavedWork;
  }, [mode, isDirty, batchHasUnsavedWork]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let unlisten: (() => void) | undefined;

    void getCurrentWindow()
      .onDragDropEvent(async (event) => {
        if (event.payload.type === "enter") {
          setDragActive(true);
          return;
        }

        if (event.payload.type === "leave") {
          setDragActive(false);
          return;
        }

        if (event.payload.type === "drop") {
          setDragActive(false);
          if (modeRef.current === "batch") {
            await handleBatchPathDrop(event.payload.paths);
            return;
          }

          await handleSinglePathDrop(event.payload.paths);
        }
      })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch(() => {
        setDragActive(false);
      });

    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let unlisten: (() => void) | undefined;

    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (!hasUnsavedWorkRef.current) {
          return;
        }

        const shouldDiscard = await confirm(
          modeRef.current === "single"
            ? "You have unsaved changes. Close the editor anyway?"
            : "You have unapplied batch changes. Close the editor anyway?",
          {
            title: "Unsaved changes",
            kind: "warning",
            okLabel: "Close anyway",
            cancelLabel: "Keep editing",
          },
        );

        if (!shouldDiscard) {
          event.preventDefault();
        }
      })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch(() => undefined);

    return () => {
      unlisten?.();
    };
  }, []);

  async function handleModeChange(nextMode: WorkspaceMode) {
    if (nextMode === mode) {
      return;
    }

    if (!(await confirmDiscardCurrentWork())) {
      return;
    }

    setMode(nextMode);
    setStatusMessage(
      nextMode === "single"
        ? "Switched to the single contact editor."
        : "Switched to batch editing. Import multiple files or a folder to begin.",
    );
  }

  async function handleOpen() {
    if (!(await confirmDiscardCurrentWork())) {
      return;
    }

    try {
      const path = await openVcf();
      if (!path) {
        return;
      }

      await loadSinglePath(path);
    } catch (error) {
      await showError("Could not open a file", error);
    }
  }

  async function handleNewDraft() {
    if (!(await confirmDiscardCurrentWork())) {
      return;
    }

    const draft = touchManagedMetadata(createEmptyDocument("4.0"));
    setSession({
      document: draft,
      sourcePath: null,
      savedSnapshot: serializeVcf(draft),
      parseWarnings: [],
    });
    setMode("single");
    setStatusMessage("Started a blank vCard draft.");
  }

  async function handleSave() {
    if (!session) {
      return;
    }

    if (blockingIssues.length > 0) {
      await showError(
        "Resolve validation errors first",
        "The file still has blocking validation errors and cannot be saved yet.",
      );
      return;
    }

    try {
      const documentToSave = touchManagedMetadata(session.document);
      const content = serializeVcf(documentToSave);
      const targetPath =
        session.sourcePath ??
        (await saveVcfAs(buildSuggestedPath(session.sourcePath, session.document)));

      if (!targetPath) {
        return;
      }

      await persistDocument(targetPath, documentToSave, content);
    } catch (error) {
      await showError("Could not save the file", error);
    }
  }

  async function handleSaveAs() {
    if (!session) {
      return;
    }

    if (blockingIssues.length > 0) {
      await showError(
        "Resolve validation errors first",
        "The file still has blocking validation errors and cannot be saved yet.",
      );
      return;
    }

    try {
      const documentToSave = touchManagedMetadata(session.document);
      const content = serializeVcf(documentToSave);
      const targetPath = await saveVcfAs(buildSuggestedPath(session.sourcePath, session.document));
      if (!targetPath) {
        return;
      }

      await persistDocument(targetPath, documentToSave, content);
    } catch (error) {
      await showError("Could not save the file", error);
    }
  }

  async function handleBatchAddFiles() {
    try {
      const paths = await openManyVcf();
      if (paths.length === 0) {
        return;
      }

      await importBatchPaths(paths);
    } catch (error) {
      await showError("Could not import files", error);
    }
  }

  async function handleBatchOpenFolder() {
    try {
      const folderPath = await openVcfFolder();
      if (!folderPath) {
        return;
      }

      const paths = await listVcfFilesInDirectory(folderPath);
      if (paths.length === 0) {
        setStatusMessage("No .vcf files were found in the selected folder.");
        return;
      }

      await importBatchPaths(paths);
    } catch (error) {
      await showError("Could not import a folder", error);
    }
  }

  async function handleChooseOutputDirectory() {
    try {
      const outputDirectory = await chooseOutputDirectory();
      if (!outputDirectory) {
        return;
      }

      updateBatch((current) => ({
        ...current,
        outputDirectory,
      }));
      setStatusMessage(`Selected ${getPathLabel(outputDirectory)} as the batch output folder.`);
    } catch (error) {
      await showError("Could not choose an output directory", error);
    }
  }

  async function handleBatchPreview() {
    if (batch.selectedIds.length === 0) {
      await showError("Nothing selected", "Select at least one batch item to preview the apply run.");
      return;
    }

    const preview = buildActiveBatchPreview();
    setBatch((current) => ({
      ...current,
      preview,
    }));
    setStatusMessage(
      preview.writeCount > 0
        ? `Preview prepared for ${preview.writeCount} file(s).`
        : "Nothing would be written with the current selection and settings.",
    );
  }

  async function handleBatchApply() {
    const preview = batch.preview ?? buildActiveBatchPreview();

    if (preview.writeCount === 0) {
      await showError(
        "Nothing to apply",
        "The current selection does not contain any writable changes.",
      );
      return;
    }

    try {
      setBusyLabel("Applying");
      const itemResults = new Map<
        string,
        {
          status: BatchItem["status"];
          message: string;
          document?: VCardDocument | null;
          content?: string;
          outputPath?: string;
          updateSavedSnapshot: boolean;
        }
      >();

      for (const entry of preview.entries) {
        if (entry.action !== "write" || !entry.document) {
          continue;
        }

        const sourceItem = batch.items.find((item) => item.id === entry.itemId);

        if (!sourceItem) {
          continue;
        }

        try {
          if (batch.writeMode === "in-place") {
            if (!entry.backupPath) {
              throw new Error("No backup path was created for the in-place batch write.");
            }

            await writeVcfFile(entry.backupPath, sourceItem.persistedContent);
            await writeVcfFile(entry.targetPath, entry.content);

            itemResults.set(entry.itemId, {
              status: "updated",
              message: `Updated in place and created ${getPathLabel(entry.backupPath)}.`,
              document: entry.document,
              content: entry.content,
              updateSavedSnapshot: true,
            });
            continue;
          }

          await writeVcfFile(entry.targetPath, entry.content);
          itemResults.set(entry.itemId, {
            status: "updated",
            message: `Exported to ${getPathLabel(entry.targetPath)}.`,
            document: entry.document,
            content: entry.content,
            outputPath: entry.targetPath,
            updateSavedSnapshot: false,
          });
        } catch (error) {
          itemResults.set(entry.itemId, {
            status: "failed",
            message: toErrorMessage(error),
            updateSavedSnapshot: false,
          });
        }
      }

      setBatch((current) => ({
        ...current,
        items: current.items.map((item) => {
          const previewEntry = preview.entries.find((entry) => entry.itemId === item.id);
          const writeResult = itemResults.get(item.id);

          if (writeResult) {
            if (writeResult.updateSavedSnapshot && writeResult.content && writeResult.document) {
              return {
                ...item,
                document: writeResult.document,
                savedSnapshot: writeResult.content,
                persistedContent: writeResult.content,
                status: writeResult.status,
                statusMessage: writeResult.message,
                lastOutputPath: undefined,
              };
            }

            return {
              ...item,
              document: writeResult.document ?? item.document,
              status: writeResult.status,
              statusMessage: writeResult.message,
              lastOutputPath: writeResult.outputPath ?? item.lastOutputPath,
            };
          }

          if (previewEntry?.action === "skip") {
            return {
              ...item,
              status: previewEntry.reason?.toLowerCase().includes("error") ? "failed" : "skipped",
              statusMessage: previewEntry.reason,
            };
          }

          return item;
        }),
        patch: selectedValidBatchItems.length > 1 ? createEmptyBatchPatch() : current.patch,
        preview,
      }));

      setStatusMessage(
        batch.writeMode === "in-place"
          ? `Applied batch changes to ${preview.writeCount} file(s) in place.`
          : `Exported ${preview.writeCount} batch file(s) to the chosen folder.`,
      );
    } catch (error) {
      await showError("Could not apply the batch run", error);
    } finally {
      setBusyLabel(null);
    }
  }

  async function persistDocument(
    targetPath: string,
    document: VCardDocument,
    content: string,
  ) {
    try {
      setBusyLabel("Saving");
      await writeVcfFile(targetPath, content);

      setSession((current) =>
        current
          ? {
              ...current,
              document,
              sourcePath: targetPath,
              savedSnapshot: content,
            }
          : current,
      );
      setStatusMessage(`Saved ${getPathLabel(targetPath)}.`);
    } catch (error) {
      await showError("Could not save the file", error);
    } finally {
      setBusyLabel(null);
    }
  }

  async function loadSinglePath(path: string) {
    try {
      setBusyLabel("Opening");
      const text = await readVcfFile(path);
      const result = parseVcf(text);
      const stableSnapshot = serializeVcf(result.document);

      setSession({
        document: result.document,
        sourcePath: path,
        savedSnapshot: stableSnapshot,
        parseWarnings: result.warnings,
      });
      setMode("single");
      setStatusMessage(
        result.warnings.length > 0
          ? `Opened ${getPathLabel(path)} with ${result.warnings.length} import warning(s).`
          : `Opened ${getPathLabel(path)}.`,
      );
    } catch (error) {
      await showError("Could not read this vCard", error);
    } finally {
      setBusyLabel(null);
    }
  }

  async function importBatchPaths(paths: string[]) {
    try {
      setBusyLabel("Importing");
      const uniquePaths = Array.from(
        new Set(paths.filter((path) => path.toLowerCase().endsWith(".vcf"))),
      );

      const importedItems = await Promise.all(
        uniquePaths.map(async (path) => {
          try {
            const content = await readVcfFile(path);
            return createBatchItem(path, content);
          } catch (error) {
            return createFailedBatchItem(path, toErrorMessage(error));
          }
        }),
      );

      setBatch((current) => {
        const nextItems = mergeBatchItems(current.items, importedItems);
        const nextSelectedIds =
          current.selectedIds.length > 0
            ? current.selectedIds.filter((id) => nextItems.some((item) => item.id === id))
            : nextItems.find((item) => item.document)?.id
              ? [nextItems.find((item) => item.document)?.id ?? ""]
              : [];

        return {
          ...current,
          items: nextItems,
          selectedIds: nextSelectedIds.filter(Boolean),
          preview: null,
        };
      });

      setMode("batch");
      setStatusMessage(`Imported ${importedItems.length} vCard file(s) into the batch workspace.`);
    } finally {
      setBusyLabel(null);
    }
  }

  async function handleSinglePathDrop(paths: string[]) {
    const firstVcf = paths.find((path) => path.toLowerCase().endsWith(".vcf"));
    if (!firstVcf) {
      await showError("Unsupported drop", "Drop exactly one .vcf file to open it.");
      return;
    }

    if (!(await confirmDiscardCurrentWork())) {
      return;
    }

    await loadSinglePath(firstVcf);
  }

  async function handleBatchPathDrop(paths: string[]) {
    const vcfPaths = paths.filter((path) => path.toLowerCase().endsWith(".vcf"));
    if (vcfPaths.length === 0) {
      await showError("Unsupported drop", "Drop one or more .vcf files to batch import them.");
      return;
    }

    await importBatchPaths(vcfPaths);
  }

  async function confirmDiscardCurrentWork() {
    if (mode === "single") {
      if (!isDirty) {
        return true;
      }

      return confirm("You have unsaved changes. Discard them and continue?", {
        title: "Unsaved changes",
        kind: "warning",
        okLabel: "Discard changes",
        cancelLabel: "Keep editing",
      });
    }

    if (!batchHasUnsavedWork) {
      return true;
    }

    return confirm(
      "You have dirty batch items or an unapplied batch patch. Discard them and continue?",
      {
        title: "Unapplied batch changes",
        kind: "warning",
        okLabel: "Discard changes",
        cancelLabel: "Keep editing",
      },
    );
  }

  async function showError(title: string, error: unknown) {
    const text = toErrorMessage(error);
    setStatusMessage(text);

    if (isTauriRuntime()) {
      await message(text, {
        title,
        kind: "error",
      });
    }
  }

  function updateSingleDocument(update: (document: VCardDocument) => VCardDocument) {
    setSession((current) =>
      current
        ? {
            ...current,
            document: ensureManagedMetadata(update(current.document)),
          }
        : current,
    );
  }

  function createSingleController(): DocumentEditorController {
    return createDocumentController(
      updateSingleDocument,
      () => handleChoosePhoto({ kind: "single" }),
      () =>
        updateSingleDocument((document) => ({
          ...document,
          photo: null,
        })),
    );
  }

  function createBatchItemController(itemId: string): DocumentEditorController {
    return createDocumentController(
      (update) => updateBatchItemDocument(itemId, update),
      () => handleChoosePhoto({ kind: "batch-item", itemId }),
      () =>
        updateBatchItemDocument(itemId, (document) => ({
          ...document,
          photo: null,
        })),
    );
  }

  function updateBatch(mutator: (workspace: BatchWorkspace) => BatchWorkspace) {
    setBatch((current) => {
      const next = mutator(current);
      return {
        ...next,
        preview: null,
      };
    });
  }

  function updateBatchItemDocument(
    itemId: string,
    update: (document: VCardDocument) => VCardDocument,
  ) {
    updateBatch((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.id === itemId && item.document
          ? {
              ...item,
              document: ensureManagedMetadata(update(item.document)),
              status: "ready",
              statusMessage: undefined,
            }
          : item,
      ),
    }));
  }

  function updateBatchPatch(mutator: (patch: BatchPatch) => BatchPatch) {
    updateBatch((current) => ({
      ...current,
      patch: mutator(current.patch),
    }));
  }

  function handleChoosePhoto(target: Exclude<PhotoTarget, null>) {
    setPhotoTarget(target);
    photoInputRef.current?.click();
  }

  async function handlePhotoSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";

    if (!file || !photoTarget) {
      return;
    }

    try {
      if (!file.type.startsWith("image/")) {
        throw new Error("Only image files can be used as a contact photo.");
      }

      const photo = await readFileAsPhotoValue(file);

      if (photoTarget.kind === "single") {
        updateSingleDocument((document) => ({
          ...document,
          photo,
        }));
        setStatusMessage(`Added profile image ${file.name}.`);
        return;
      }

      if (photoTarget.kind === "batch-item") {
        updateBatchItemDocument(photoTarget.itemId, (document) => ({
          ...document,
          photo,
        }));
        setStatusMessage(`Updated the selected batch contact image to ${file.name}.`);
        return;
      }

      updateBatchPatch((patch) => ({
        ...patch,
        photo: {
          mode: "replace",
          value: photo,
        },
      }));
      setStatusMessage(`Prepared ${file.name} as the replacement photo for the batch patch.`);
    } catch (error) {
      await showError("Could not add the profile image", error);
    } finally {
      setPhotoTarget(null);
    }
  }

  function buildActiveBatchPreview() {
    return buildBatchPreviewSummary(batch.items, batch.selectedIds, {
      patch: selectedValidBatchItems.length > 1 ? batch.patch : null,
      writeMode: batch.writeMode,
      outputDirectory: batch.outputDirectory,
    });
  }

  const singleController = createSingleController();

  return (
    <main className={`app-shell${dragActive ? " app-shell--drag" : ""}`}>
      <div className="background-glow background-glow--top" />
      <div className="background-glow background-glow--bottom" />
      <input
        ref={photoInputRef}
        className="visually-hidden"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif,image/bmp"
        onChange={handlePhotoSelected}
      />

      <header className="app-header">
        <div className="brand">
          <span className="brand__eyebrow">Local vCard utility</span>
          <div>
            <h1>vCard Editor</h1>
            <p className="brand__subtitle">
              Focused editing for a single contact file or a curated batch apply run.
            </p>
          </div>
        </div>

        <div className="header-meta">
          <div className="meta-card">
            <span className="meta-card__label">Mode</span>
            <strong>{mode === "single" ? "Single editor" : "Batch editor"}</strong>
          </div>
          <div className="meta-card">
            <span className="meta-card__label">State</span>
            <strong>
              {busyLabel ??
                (mode === "single"
                  ? isDirty
                    ? "Unsaved changes"
                    : "Synced"
                  : batchHasUnsavedWork
                    ? "Pending apply"
                    : "Ready")}
            </strong>
          </div>
          <div className="meta-card">
            <span className="meta-card__label">
              {mode === "single" ? "File" : "Imported files"}
            </span>
            <strong>
              {mode === "single"
                ? getPathLabel(session?.sourcePath ?? null)
                : `${batch.items.length} loaded / ${batch.selectedIds.length} selected`}
            </strong>
          </div>
        </div>

        <div className="header-actions">
          <div className="mode-tabs" role="tablist" aria-label="Editor mode">
            <button
              type="button"
              className={`mode-tab${mode === "single" ? " mode-tab--active" : ""}`}
              onClick={() => void handleModeChange("single")}
              role="tab"
              aria-selected={mode === "single"}
            >
              Single
            </button>
            <button
              type="button"
              className={`mode-tab${mode === "batch" ? " mode-tab--active" : ""}`}
              onClick={() => void handleModeChange("batch")}
              role="tab"
              aria-selected={mode === "batch"}
            >
              Batch
            </button>
          </div>

          {mode === "single" ? (
            <>
              <button type="button" className="button button--ghost" onClick={handleOpen}>
                Open
              </button>
              <button type="button" className="button button--ghost" onClick={handleNewDraft}>
                New blank
              </button>
              <button
                type="button"
                className="button"
                onClick={handleSave}
                disabled={!session || !!busyLabel}
              >
                Save
              </button>
              <button
                type="button"
                className="button button--secondary"
                onClick={handleSaveAs}
                disabled={!session || !!busyLabel}
              >
                Save As
              </button>
            </>
          ) : null}
        </div>
      </header>

      <div className="status-bar">
        <span
          className={`status-pill${
            (mode === "single" && isDirty) || (mode === "batch" && batchHasUnsavedWork)
              ? " status-pill--warning"
              : ""
          }`}
        >
          {mode === "single"
            ? isDirty
              ? "Unsaved"
              : "Ready"
            : batchHasUnsavedWork
              ? "Pending"
              : "Ready"}
        </span>
        <p>{statusMessage}</p>
      </div>

      {mode === "single" ? (
        !session ? (
          <section className="empty-state" data-testid="empty-state">
            <div className="empty-state__panel">
              <span className="empty-state__eyebrow">Simple first step</span>
              <h2>Edit one `.vcf` file with clarity.</h2>
              <p>
                Start from an existing export or a blank card. The preview on the
                right side appears as soon as a document is loaded.
              </p>
              <div className="empty-state__actions">
                <button type="button" className="button" onClick={handleOpen}>
                  Open a vCard file
                </button>
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={handleNewDraft}
                >
                  Start blank
                </button>
              </div>
            </div>

            <div className="empty-state__guide">
              <div className="guide-card">
                <h3>Included in single mode</h3>
                <ul>
                  <li>One `.vcf` file at a time</li>
                  <li>Structured form editing</li>
                  <li>Validation before save</li>
                  <li>Read-only raw preview</li>
                </ul>
              </div>
              <div className="guide-card">
                <h3>Safe behavior</h3>
                <ul>
                  <li>Unknown properties are preserved</li>
                  <li>Import warnings stay visible while editing</li>
                  <li>Save and Save As keep the flow explicit</li>
                </ul>
              </div>
            </div>
          </section>
        ) : (
          <section className="workspace">
            <div className="editor-column">
              <DocumentForm document={session.document} controller={singleController} />
            </div>

            <aside className="side-column">
              <DocumentInsightsPanel
                parseWarnings={session.parseWarnings}
                issues={validationIssues}
                unknownPropertyCount={session.document.unknownProperties.length}
                document={session.document}
                serializedDocument={serializedDocument}
              />
            </aside>
          </section>
        )
      ) : (
        <section className="workspace workspace--batch" data-testid="batch-workspace">
          <div className="editor-column">
            <SectionCard
              title="Batch set"
              description="Import many vCards, search them, select them and prepare a safe apply run."
            >
              <div className="batch-toolbar">
                <div className="batch-toolbar__actions">
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={handleBatchAddFiles}
                  >
                    Add files
                  </button>
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={handleBatchOpenFolder}
                  >
                    Open folder
                  </button>
                </div>
                <div className="batch-toolbar__search">
                  <FieldGroup
                    label="Search"
                    hint="Filter by file name, display name, organization, title or role."
                  >
                    <input
                      value={batch.search}
                      onChange={(event) =>
                        updateBatch((current) => ({
                          ...current,
                          search: event.currentTarget.value,
                        }))
                      }
                      placeholder="Search the batch set"
                      autoComplete="off"
                    />
                  </FieldGroup>
                </div>
              </div>

              {batch.items.length === 0 ? (
                <p className="section-empty">
                  No batch items yet. Add multiple `.vcf` files or import a folder to start.
                </p>
              ) : (
                <div className="batch-table-wrap">
                  <div className="batch-table-actions">
                    <label className="batch-select-all">
                      <input
                        type="checkbox"
                        checked={
                          visibleBatchItems.filter((item) => item.document).length > 0 &&
                          visibleBatchItems
                            .filter((item) => item.document)
                            .every((item) => batch.selectedIds.includes(item.id))
                        }
                        onChange={() => {
                          const visibleValidIds = visibleBatchItems
                            .filter((item) => item.document)
                            .map((item) => item.id);

                          updateBatch((current) => {
                            const everySelected = visibleValidIds.every((id) =>
                              current.selectedIds.includes(id),
                            );

                            return {
                              ...current,
                              selectedIds: everySelected
                                ? current.selectedIds.filter((id) => !visibleValidIds.includes(id))
                                : Array.from(new Set([...current.selectedIds, ...visibleValidIds])),
                            };
                          });
                        }}
                      />
                      <span>Select visible valid files</span>
                    </label>
                    <span className="batch-counter">
                      {visibleBatchItems.length} visible / {batch.selectedIds.length} selected
                    </span>
                  </div>

                  <table className="batch-table">
                    <thead>
                      <tr>
                        <th>Select</th>
                        <th>File</th>
                        <th>Formatted name</th>
                        <th>Organization</th>
                        <th>Title</th>
                        <th>Role</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleBatchItems.map((item) => {
                        const document = item.document;
                        const itemIssues = getBatchItemValidationIssues(item);
                        const isSelected = batch.selectedIds.includes(item.id);

                        return (
                          <tr
                            key={item.id}
                            className={isSelected ? "batch-table__row batch-table__row--selected" : "batch-table__row"}
                            onClick={() => {
                              if (!document) {
                                return;
                              }

                              updateBatch((current) => ({
                                ...current,
                                selectedIds: [item.id],
                              }));
                            }}
                          >
                            <td>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                disabled={!document}
                                onChange={(event) => {
                                  event.stopPropagation();

                                  if (!document) {
                                    return;
                                  }

                                  updateBatch((current) => ({
                                    ...current,
                                    selectedIds: event.currentTarget.checked
                                      ? Array.from(new Set([...current.selectedIds, item.id]))
                                      : current.selectedIds.filter((id) => id !== item.id),
                                  }));
                                }}
                              />
                            </td>
                            <td>{getPathLabel(item.sourcePath)}</td>
                            <td>{document?.formattedName || "Unreadable file"}</td>
                            <td>{document?.organizationUnits[0] ?? "—"}</td>
                            <td>{document?.title || "—"}</td>
                            <td>{document?.role || "—"}</td>
                            <td>
                              <div className="batch-status-cell">
                                <span className={`status-pill${item.status === "failed" ? " status-pill--warning" : ""}`}>
                                  {item.status}
                                </span>
                                <span className="batch-status-text">
                                  {item.statusMessage ??
                                    (item.parseWarnings.length > 0
                                      ? `${item.parseWarnings.length} warning(s)`
                                      : itemIssues.some((issue) => issue.level === "error")
                                        ? "Validation errors"
                                        : isBatchItemDirty(item)
                                          ? "Unsaved item changes"
                                          : "Ready")}
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          </div>

          <aside className="side-column">
            {batch.items.length === 0 ? (
              <SectionCard
                title="Batch editor"
                description="The hybrid batch flow combines table selection with a full inspector and a patch panel."
              >
                <p className="section-empty">
                  Import files first. One selected file opens the full editor here; multiple selected files open the patch builder.
                </p>
              </SectionCard>
            ) : selectedValidBatchItems.length === 1 ? (
              <>
                <SectionCard
                  title="Selected contact"
                  description="This is the full structured editor for the currently selected batch item."
                >
                  <DocumentForm
                    document={selectedValidBatchItems[0].document ?? createEmptyDocument()}
                    controller={createBatchItemController(selectedValidBatchItems[0].id)}
                  />
                </SectionCard>
                <DocumentInsightsPanel
                  parseWarnings={selectedValidBatchItems[0].parseWarnings}
                  issues={getBatchItemValidationIssues(selectedValidBatchItems[0])}
                  unknownPropertyCount={
                    selectedValidBatchItems[0].document?.unknownProperties.length ?? 0
                  }
                  document={selectedValidBatchItems[0].document ?? createEmptyDocument()}
                  serializedDocument={getBatchItemSerialized(selectedValidBatchItems[0])}
                />
              </>
            ) : selectedValidBatchItems.length > 1 ? (
              <BatchPatchPanel
                selectionCount={selectedValidBatchItems.length}
                patch={batch.patch}
                onPatchChange={updateBatchPatch}
                onChoosePhoto={() => handleChoosePhoto({ kind: "batch-patch" })}
              />
            ) : selectedInvalidBatchItems.length > 0 ? (
              <SectionCard
                title="Unreadable selection"
                description="Some imported files could not be parsed and can only be inspected via status messages."
              >
                <p className="section-empty">
                  The current selection only contains unreadable files. Fix or remove them before running a batch apply.
                </p>
              </SectionCard>
            ) : (
              <SectionCard
                title="No selection"
                description="Select one or more imported files to edit or patch them."
              >
                <p className="section-empty">
                  Select one valid file for the full inspector or multiple valid files for the batch patch panel.
                </p>
              </SectionCard>
            )}

            <SectionCard
              title="Apply run"
              description="Preview is mandatory before writing. Choose between in-place updates and an output folder."
            >
              <div className="stack">
                <FieldGroup
                  label="Write mode"
                  hint="In-place creates timestamped backups. Output directory keeps source files untouched."
                >
                  <select
                    value={batch.writeMode}
                    onChange={(event) =>
                      updateBatch((current) => ({
                        ...current,
                        writeMode: event.currentTarget.value as BatchWriteMode,
                      }))
                    }
                  >
                    <option value="in-place">In-place with backups</option>
                    <option value="output-directory">Write copies to output folder</option>
                  </select>
                </FieldGroup>

                {batch.writeMode === "output-directory" ? (
                  <div className="batch-output-row">
                    <span className="batch-output-label">
                      {batch.outputDirectory
                        ? `Output: ${getPathLabel(batch.outputDirectory)}`
                        : "No output directory selected yet"}
                    </span>
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={handleChooseOutputDirectory}
                    >
                      Choose output folder
                    </button>
                  </div>
                ) : null}

                <div className="batch-apply-actions">
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={handleBatchPreview}
                    disabled={batch.selectedIds.length === 0}
                  >
                    Preview apply
                  </button>
                  <button
                    type="button"
                    className="button"
                    onClick={handleBatchApply}
                    disabled={batch.selectedIds.length === 0 || !!busyLabel}
                  >
                    Apply changes
                  </button>
                </div>

                {batch.preview ? (
                  <div className="batch-preview">
                    <div className="validation-summary">
                      <div className="summary-chip">
                        <span>Write</span>
                        <strong>{batch.preview.writeCount}</strong>
                      </div>
                      <div className="summary-chip">
                        <span>Skip</span>
                        <strong>{batch.preview.skipCount}</strong>
                      </div>
                      <div className="summary-chip">
                        <span>Errors</span>
                        <strong>{batch.preview.errorCount}</strong>
                      </div>
                    </div>

                    <div className="stack">
                      {batch.preview.entries.map((entry) => (
                        <article
                          key={`${entry.itemId}-${entry.targetPath}`}
                          className={`issue issue--${entry.action === "write" ? "warning" : "error"}`}
                        >
                          <span className="issue__badge">
                            {entry.action === "write" ? "write" : "skip"}
                          </span>
                          <div>
                            <strong>{getPathLabel(entry.sourcePath)}</strong>
                            <p>
                              {entry.action === "write"
                                ? entry.targetPath === entry.sourcePath
                                  ? `Will update ${getPathLabel(entry.targetPath)} in place.`
                                  : `Will export ${getPathLabel(entry.targetPath)}.`
                                : entry.reason}
                            </p>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="section-empty">
                    Preview the current selection to see exactly what would be written.
                  </p>
                )}
              </div>
            </SectionCard>
          </aside>
        </section>
      )}
    </main>
  );
}

interface BatchPatchPanelProps {
  selectionCount: number;
  patch: BatchPatch;
  onPatchChange: (mutator: (patch: BatchPatch) => BatchPatch) => void;
  onChoosePhoto: () => void;
}

function BatchPatchPanel({
  selectionCount,
  patch,
  onPatchChange,
  onChoosePhoto,
}: BatchPatchPanelProps) {
  return (
    <SectionCard
      title="Batch patch"
      description={`This patch will be applied to ${selectionCount} selected contacts after preview and apply.`}
    >
      <div className="stack">
        <PatchTextField
          label="Formatted name (FN)"
          hint="Replace or clear the display name on all selected files."
          mode={patch.formattedName.mode}
          value={patch.formattedName.value}
          onModeChange={(mode) =>
            onPatchChange((current) => ({
              ...current,
              formattedName: {
                ...current.formattedName,
                mode,
              },
            }))
          }
          onValueChange={(value) =>
            onPatchChange((current) => ({
              ...current,
              formattedName: {
                ...current.formattedName,
                value,
              },
            }))
          }
        />

        <SectionCard
          title="Structured name"
          description="Replace or clear the full N structure on all selected contacts."
        >
          <PatchModeToolbar
            mode={patch.name.mode}
            modes={["keep", "replace", "clear"]}
            onChange={(mode) =>
              onPatchChange((current) => ({
                ...current,
                name: {
                  ...current.name,
                  mode,
                },
              }))
            }
          />
          {patch.name.mode === "replace" ? (
            <div className="grid grid--two">
              <FieldGroup label="Given name">
                <input
                  value={patch.name.value.given}
                  onChange={(event) =>
                    onPatchChange((current) => ({
                      ...current,
                      name: {
                        ...current.name,
                        value: {
                          ...current.name.value,
                          given: event.currentTarget.value,
                        },
                      },
                    }))
                  }
                />
              </FieldGroup>
              <FieldGroup label="Family name">
                <input
                  value={patch.name.value.family}
                  onChange={(event) =>
                    onPatchChange((current) => ({
                      ...current,
                      name: {
                        ...current.name,
                        value: {
                          ...current.name.value,
                          family: event.currentTarget.value,
                        },
                      },
                    }))
                  }
                />
              </FieldGroup>
              <FieldGroup label="Additional names">
                <input
                  value={patch.name.value.additional}
                  onChange={(event) =>
                    onPatchChange((current) => ({
                      ...current,
                      name: {
                        ...current.name,
                        value: {
                          ...current.name.value,
                          additional: event.currentTarget.value,
                        },
                      },
                    }))
                  }
                />
              </FieldGroup>
              <FieldGroup label="Prefix">
                <input
                  value={patch.name.value.prefix}
                  onChange={(event) =>
                    onPatchChange((current) => ({
                      ...current,
                      name: {
                        ...current.name,
                        value: {
                          ...current.name.value,
                          prefix: event.currentTarget.value,
                        },
                      },
                    }))
                  }
                />
              </FieldGroup>
              <FieldGroup label="Suffix">
                <input
                  value={patch.name.value.suffix}
                  onChange={(event) =>
                    onPatchChange((current) => ({
                      ...current,
                      name: {
                        ...current.name,
                        value: {
                          ...current.name.value,
                          suffix: event.currentTarget.value,
                        },
                      },
                    }))
                  }
                />
              </FieldGroup>
            </div>
          ) : null}
        </SectionCard>

        <PatchTextField
          label="Nicknames"
          hint="Replace or append comma-separated nicknames."
          mode={patch.nicknames.mode}
          value={patch.nicknames.value.join(", ")}
          list
          onModeChange={(mode) =>
            onPatchChange((current) => ({
              ...current,
              nicknames: {
                ...current.nicknames,
                mode,
              },
            }))
          }
          onValueChange={(value) =>
            onPatchChange((current) => ({
              ...current,
              nicknames: {
                ...current.nicknames,
                value: splitCommaSeparated(value),
              },
            }))
          }
        />

        <PatchTextField
          label="Organization"
          hint="Replace or append semicolon-separated organization units."
          mode={patch.organizationUnits.mode}
          value={patch.organizationUnits.value.join("; ")}
          list
          onModeChange={(mode) =>
            onPatchChange((current) => ({
              ...current,
              organizationUnits: {
                ...current.organizationUnits,
                mode,
              },
            }))
          }
          onValueChange={(value) =>
            onPatchChange((current) => ({
              ...current,
              organizationUnits: {
                ...current.organizationUnits,
                value: splitSemicolonSeparated(value),
              },
            }))
          }
        />

        <PatchTextField
          label="Title"
          hint="Replace or clear the title."
          mode={patch.title.mode}
          value={patch.title.value}
          onModeChange={(mode) =>
            onPatchChange((current) => ({
              ...current,
              title: {
                ...current.title,
                mode,
              },
            }))
          }
          onValueChange={(value) =>
            onPatchChange((current) => ({
              ...current,
              title: {
                ...current.title,
                value,
              },
            }))
          }
        />

        <PatchTextField
          label="Role"
          hint="Replace or clear the role."
          mode={patch.role.mode}
          value={patch.role.value}
          onModeChange={(mode) =>
            onPatchChange((current) => ({
              ...current,
              role: {
                ...current.role,
                mode,
              },
            }))
          }
          onValueChange={(value) =>
            onPatchChange((current) => ({
              ...current,
              role: {
                ...current.role,
                value,
              },
            }))
          }
        />

        <PatchTextField
          label="Birthday"
          hint="Replace or clear the birthday using YYYY-MM-DD."
          mode={patch.birthday.mode}
          value={patch.birthday.value}
          type="date"
          onModeChange={(mode) =>
            onPatchChange((current) => ({
              ...current,
              birthday: {
                ...current.birthday,
                mode,
              },
            }))
          }
          onValueChange={(value) =>
            onPatchChange((current) => ({
              ...current,
              birthday: {
                ...current.birthday,
                value,
              },
            }))
          }
        />

        <PatchTextField
          label="Anniversary"
          hint="Replace or clear the anniversary using YYYY-MM-DD."
          mode={patch.anniversary.mode}
          value={patch.anniversary.value}
          type="date"
          onModeChange={(mode) =>
            onPatchChange((current) => ({
              ...current,
              anniversary: {
                ...current.anniversary,
                mode,
              },
            }))
          }
          onValueChange={(value) =>
            onPatchChange((current) => ({
              ...current,
              anniversary: {
                ...current.anniversary,
                value,
              },
            }))
          }
        />

        <PatchPhotoField
          patch={patch}
          onChoosePhoto={onChoosePhoto}
          onModeChange={(mode) =>
            onPatchChange((current) => ({
              ...current,
              photo: {
                ...current.photo,
                mode,
                value: mode === "clear" ? null : current.photo.value,
              },
            }))
          }
          onClearPhoto={() =>
            onPatchChange((current) => ({
              ...current,
              photo: {
                mode: "clear",
                value: null,
              },
            }))
          }
        />

        <PatchContactSection
          title="Email addresses"
          description="Replace, append or clear email entries on all selected files."
          entries={patch.emails.value}
          mode={patch.emails.mode}
          kind="email"
          addLabel="Add email"
          placeholder="jane@company.com"
          onModeChange={(mode) =>
            onPatchChange((current) => ({
              ...current,
              emails: {
                ...current.emails,
                mode,
              },
            }))
          }
          onEntriesChange={(value) =>
            onPatchChange((current) => ({
              ...current,
              emails: {
                ...current.emails,
                value,
              },
            }))
          }
        />

        <PatchContactSection
          title="Phone numbers"
          description="Replace, append or clear phone entries on all selected files."
          entries={patch.phones.value}
          mode={patch.phones.mode}
          kind="phone"
          addLabel="Add phone"
          placeholder="+49 151 23456789"
          onModeChange={(mode) =>
            onPatchChange((current) => ({
              ...current,
              phones: {
                ...current.phones,
                mode,
              },
            }))
          }
          onEntriesChange={(value) =>
            onPatchChange((current) => ({
              ...current,
              phones: {
                ...current.phones,
                value,
              },
            }))
          }
        />

        <PatchContactSection
          title="URLs"
          description="Replace, append or clear URL entries on all selected files."
          entries={patch.urls.value}
          mode={patch.urls.mode}
          kind="url"
          addLabel="Add URL"
          placeholder="https://example.com"
          onModeChange={(mode) =>
            onPatchChange((current) => ({
              ...current,
              urls: {
                ...current.urls,
                mode,
              },
            }))
          }
          onEntriesChange={(value) =>
            onPatchChange((current) => ({
              ...current,
              urls: {
                ...current.urls,
                value,
              },
            }))
          }
        />

        <PatchContactSection
          title="Instant messaging"
          description="Replace, append or clear IM entries on all selected files."
          entries={patch.impps.value}
          mode={patch.impps.mode}
          kind="impp"
          addLabel="Add IM URI"
          placeholder="xmpp:jane@example.com"
          onModeChange={(mode) =>
            onPatchChange((current) => ({
              ...current,
              impps: {
                ...current.impps,
                mode,
              },
            }))
          }
          onEntriesChange={(value) =>
            onPatchChange((current) => ({
              ...current,
              impps: {
                ...current.impps,
                value,
              },
            }))
          }
        />

        <PatchAddressSection
          entries={patch.addresses.value}
          mode={patch.addresses.mode}
          onModeChange={(mode) =>
            onPatchChange((current) => ({
              ...current,
              addresses: {
                ...current.addresses,
                mode,
              },
            }))
          }
          onEntriesChange={(value) =>
            onPatchChange((current) => ({
              ...current,
              addresses: {
                ...current.addresses,
                value,
              },
            }))
          }
        />

        <PatchTextField
          label="Note"
          hint="Replace or clear NOTE."
          mode={patch.note.mode}
          value={patch.note.value}
          multiline
          onModeChange={(mode) =>
            onPatchChange((current) => ({
              ...current,
              note: {
                ...current.note,
                mode,
              },
            }))
          }
          onValueChange={(value) =>
            onPatchChange((current) => ({
              ...current,
              note: {
                ...current.note,
                value,
              },
            }))
          }
        />

        <PatchTextField
          label="UID"
          hint="Replace or clear UID across the selected files."
          mode={patch.uid.mode}
          value={patch.uid.value}
          onModeChange={(mode) =>
            onPatchChange((current) => ({
              ...current,
              uid: {
                ...current.uid,
                mode,
              },
            }))
          }
          onValueChange={(value) =>
            onPatchChange((current) => ({
              ...current,
              uid: {
                ...current.uid,
                value,
              },
            }))
          }
        />

        <PatchTextField
          label="PRODID"
          hint="Replace or clear PRODID across the selected files."
          mode={patch.prodId.mode}
          value={patch.prodId.value}
          onModeChange={(mode) =>
            onPatchChange((current) => ({
              ...current,
              prodId: {
                ...current.prodId,
                mode,
              },
            }))
          }
          onValueChange={(value) =>
            onPatchChange((current) => ({
              ...current,
              prodId: {
                ...current.prodId,
                value,
              },
            }))
          }
        />
      </div>
    </SectionCard>
  );
}

interface PatchTextFieldProps {
  label: string;
  hint: string;
  value: string;
  type?: "text" | "date";
  multiline?: boolean;
  onValueChange: (value: string) => void;
}
type ScalarPatchTextFieldProps = PatchTextFieldProps & {
  list?: false;
  mode: ScalarPatchMode;
  onModeChange: (mode: ScalarPatchMode) => void;
};

type ListPatchTextFieldProps = PatchTextFieldProps & {
  list: true;
  mode: ListPatchMode;
  onModeChange: (mode: ListPatchMode) => void;
};

type PatchTextFieldComponentProps = ScalarPatchTextFieldProps | ListPatchTextFieldProps;

function PatchTextField({
  label,
  hint,
  value,
  type = "text",
  list = false,
  multiline = false,
  onValueChange,
  ...rest
}: PatchTextFieldComponentProps) {
  const content = multiline ? (
    <textarea value={value} onChange={(event) => onValueChange(event.currentTarget.value)} rows={5} />
  ) : (
    <input type={type} value={value} onChange={(event) => onValueChange(event.currentTarget.value)} />
  );

  if (list) {
    const { mode, onModeChange } = rest as ListPatchTextFieldProps;

    return (
      <SectionCard title={label} description={hint}>
        <PatchModeToolbar
          mode={mode}
          modes={["keep", "replace", "append", "clear"] as const}
          onChange={onModeChange}
        />

        {mode === "replace" || mode === "append" ? (
          <FieldGroup label={label}>{content}</FieldGroup>
        ) : null}
      </SectionCard>
    );
  }

  const { mode, onModeChange } = rest as ScalarPatchTextFieldProps;

  return (
    <SectionCard title={label} description={hint}>
      <PatchModeToolbar
        mode={mode}
        modes={["keep", "replace", "clear"] as const}
        onChange={onModeChange}
      />

      {mode === "replace" ? <FieldGroup label={label}>{content}</FieldGroup> : null}
    </SectionCard>
  );
}

interface PatchPhotoFieldProps {
  patch: BatchPatch;
  onChoosePhoto: () => void;
  onModeChange: (mode: "keep" | "replace" | "clear") => void;
  onClearPhoto: () => void;
}

function PatchPhotoField({ patch, onChoosePhoto, onModeChange, onClearPhoto }: PatchPhotoFieldProps) {
  return (
    <SectionCard
      title="Photo"
      description="Keep, replace or clear the photo on all selected contacts."
    >
      <PatchModeToolbar
        mode={patch.photo.mode}
        modes={["keep", "replace", "clear"]}
        onChange={onModeChange}
      />

      {patch.photo.mode === "replace" ? (
        <div className="stack">
          {patch.photo.value ? (
            <div className="photo-frame">
              <img
                src={patch.photo.value.uri}
                alt="Batch patch profile"
                className="photo-frame__image"
              />
            </div>
          ) : (
            <p className="section-empty">No replacement image selected yet.</p>
          )}
          <div className="photo-meta__actions">
            <button type="button" className="button button--ghost" onClick={onChoosePhoto}>
              {patch.photo.value ? "Replace image" : "Choose image"}
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={onClearPhoto}
              disabled={!patch.photo.value}
            >
              Clear selection
            </button>
          </div>
        </div>
      ) : null}
    </SectionCard>
  );
}

interface PatchContactSectionProps {
  title: string;
  description: string;
  entries: ContactValue[];
  mode: ListPatchMode;
  kind: "email" | "phone" | "url" | "impp";
  addLabel: string;
  placeholder: string;
  onModeChange: (mode: ListPatchMode) => void;
  onEntriesChange: (entries: ContactValue[]) => void;
}

function PatchContactSection({
  title,
  description,
  entries,
  mode,
  kind,
  addLabel,
  placeholder,
  onModeChange,
  onEntriesChange,
}: PatchContactSectionProps) {
  return (
    <SectionCard title={title} description={description}>
      <PatchModeToolbar
        mode={mode}
        modes={["keep", "replace", "append", "clear"] as const}
        onChange={onModeChange}
      />

      {mode === "replace" || mode === "append" ? (
        <ContactSection
          title={title}
          description={description}
          kind={kind}
          addLabel={addLabel}
          placeholder={placeholder}
          entries={entries}
          onAdd={() => onEntriesChange([...entries, createEmptyContactValue()])}
          onChange={(index, update) =>
            onEntriesChange(entries.map((entry, entryIndex) => (entryIndex === index ? update(entry) : entry)))
          }
          onMove={(index, direction) => onEntriesChange(moveItem(entries, index, direction))}
          onRemove={(index) => onEntriesChange(entries.filter((_, entryIndex) => entryIndex !== index))}
        />
      ) : null}
    </SectionCard>
  );
}

interface PatchAddressSectionProps {
  entries: AddressValue[];
  mode: ListPatchMode;
  onModeChange: (mode: ListPatchMode) => void;
  onEntriesChange: (entries: AddressValue[]) => void;
}

function PatchAddressSection({
  entries,
  mode,
  onModeChange,
  onEntriesChange,
}: PatchAddressSectionProps) {
  return (
    <SectionCard
      title="Addresses"
      description="Replace, append or clear address entries on all selected files."
    >
      <PatchModeToolbar
        mode={mode}
        modes={["keep", "replace", "append", "clear"] as const}
        onChange={onModeChange}
      />

      {mode === "replace" || mode === "append" ? (
        <AddressSection
          entries={entries}
          onAdd={() => onEntriesChange([...entries, createEmptyAddressValue()])}
          onChange={(index, update) =>
            onEntriesChange(entries.map((entry, entryIndex) => (entryIndex === index ? update(entry) : entry)))
          }
          onMove={(index, direction) => onEntriesChange(moveItem(entries, index, direction))}
          onRemove={(index) => onEntriesChange(entries.filter((_, entryIndex) => entryIndex !== index))}
        />
      ) : null}
    </SectionCard>
  );
}

interface PatchModeToolbarProps<TMode extends string> {
  mode: TMode;
  modes: readonly TMode[];
  onChange: (mode: TMode) => void;
}

function PatchModeToolbar<TMode extends string>({
  mode,
  modes,
  onChange,
}: PatchModeToolbarProps<TMode>) {
  return (
    <div className="patch-mode-toolbar">
      <FieldGroup
        label="Patch mode"
        hint="Keep leaves the field untouched. Replace or append uses the values below."
      >
        <select value={mode} onChange={(event) => onChange(event.currentTarget.value as TMode)}>
          {modes.map((candidate) => (
            <option key={candidate} value={candidate}>
              {candidate}
            </option>
          ))}
        </select>
      </FieldGroup>
    </div>
  );
}

function createEmptyBatchWorkspace(): BatchWorkspace {
  return {
    items: [],
    selectedIds: [],
    search: "",
    patch: createEmptyBatchPatch(),
    preview: null,
    writeMode: "in-place",
    outputDirectory: null,
  };
}

function createDocumentController(
  updateDocument: (update: (document: VCardDocument) => VCardDocument) => void,
  choosePhoto: () => void,
  removePhoto: () => void,
): DocumentEditorController {
  return {
    updateTextField: (field, value) =>
      updateDocument((current) => ({
        ...current,
        [field]: value,
      })),
    updateStructuredNameField: (field, value) =>
      updateDocument((current) => ({
        ...current,
        name: {
          ...current.name,
          [field]: value,
        },
      })),
    updateNicknames: (value) =>
      updateDocument((current) => ({
        ...current,
        nicknames: splitCommaSeparated(value),
      })),
    updateOrganization: (value) =>
      updateDocument((current) => ({
        ...current,
        organizationUnits: splitSemicolonSeparated(value),
      })),
    addContactEntry: (listKey) =>
      updateDocument((current) => ({
        ...current,
        [listKey]: [...current[listKey], createEmptyContactValue()],
      })),
    updateContactEntry: (listKey, index, update) =>
      updateDocument((current) => ({
        ...current,
        [listKey]: current[listKey].map((entry, entryIndex) =>
          entryIndex === index ? update(entry) : entry,
        ),
      })),
    moveContactEntry: (listKey, index, direction) =>
      updateDocument((current) => ({
        ...current,
        [listKey]: moveItem(current[listKey], index, direction),
      })),
    removeContactEntry: (listKey, index) =>
      updateDocument((current) => ({
        ...current,
        [listKey]: current[listKey].filter((_, entryIndex) => entryIndex !== index),
      })),
    addAddressEntry: () =>
      updateDocument((current) => ({
        ...current,
        addresses: [...current.addresses, createEmptyAddressValue()],
      })),
    updateAddressEntry: (index, update) =>
      updateDocument((current) => ({
        ...current,
        addresses: current.addresses.map((entry, entryIndex) =>
          entryIndex === index ? update(entry) : entry,
        ),
      })),
    moveAddressEntry: (index, direction) =>
      updateDocument((current) => ({
        ...current,
        addresses: moveItem(current.addresses, index, direction),
      })),
    removeAddressEntry: (index) =>
      updateDocument((current) => ({
        ...current,
        addresses: current.addresses.filter((_, entryIndex) => entryIndex !== index),
      })),
    choosePhoto,
    removePhoto,
  };
}

function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= items.length) {
    return items;
  }

  const nextItems = [...items];
  const [item] = nextItems.splice(index, 1);
  nextItems.splice(nextIndex, 0, item);
  return nextItems;
}

function splitCommaSeparated(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitSemicolonSeparated(value: string): string[] {
  return value
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

function mergeBatchItems(existingItems: BatchItem[], newItems: BatchItem[]): BatchItem[] {
  const itemMap = new Map(existingItems.map((item) => [item.id, item]));

  for (const item of newItems) {
    itemMap.set(item.id, item);
  }

  return Array.from(itemMap.values()).sort((left, right) =>
    left.sourcePath.localeCompare(right.sourcePath),
  );
}

function matchesBatchSearch(item: BatchItem, query: string): boolean {
  if (!query.trim()) {
    return true;
  }

  const loweredQuery = query.trim().toLowerCase();
  const document = item.document;
  return [
    item.sourcePath,
    document?.formattedName,
    document?.organizationUnits.join(" "),
    document?.title,
    document?.role,
  ]
    .filter(Boolean)
    .some((value) => value?.toLowerCase().includes(loweredQuery));
}

function readFileAsPhotoValue(file: File): Promise<PhotoValue> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(new Error("The selected image could not be read."));
    };

    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("The selected image could not be converted into an embeddable format."));
        return;
      }

      resolve({
        uri: reader.result,
        mediaType: file.type || inferMediaTypeFromDataUri(reader.result),
        isEmbedded: true,
      });
    };

    reader.readAsDataURL(file);
  });
}

function inferMediaTypeFromDataUri(value: string): string | undefined {
  const match = /^data:([^;,]+)[;,]/iu.exec(value);
  return match?.[1]?.toLowerCase();
}

function buildSuggestedPath(sourcePath: string | null, document: VCardDocument): string {
  if (sourcePath) {
    return sourcePath;
  }

  const slug =
    document.formattedName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "") || "contact";

  return `${slug}.vcf`;
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function toErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "An unknown error occurred.";
}

export default App;
