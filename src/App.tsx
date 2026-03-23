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
  type VCardVersion,
  type VCardDocument,
} from "./lib/vcard";
import {
  buildBatchPreviewSummary,
  createBatchDraftItems,
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
  creator: BatchCreatorState;
  viewMode: BatchSetViewMode;
  patch: BatchPatch;
  preview: BatchPreviewSummary | null;
  writeMode: BatchWriteMode;
  outputDirectory: string | null;
}

interface BatchCreatorState {
  baseName: string;
  count: string;
  startIndex: string;
  version: VCardVersion;
}

type BatchSetViewMode = "overview" | "power-table";
type PrimaryContactListKey = "emails" | "phones" | "urls";

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
  const batchCreator = batch.creator ?? createEmptyBatchCreatorState();
  const batchViewMode = batch.viewMode ?? "overview";
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

  async function handleBatchCreateDrafts() {
    const baseName = batchCreator.baseName.trim();

    if (!baseName) {
      await showError(
        "Base name required",
        "Enter a base name before creating batch drafts.",
      );
      return;
    }

    const count = parsePositiveInteger(batchCreator.count, 1);
    const startIndex = parsePositiveInteger(batchCreator.startIndex, 1);
    const drafts = createBatchDraftItems({
      baseName,
      count,
      startIndex,
      version: batchCreator.version,
    });

    updateBatch((current) => ({
      ...current,
      items: mergeBatchItems(current.items, drafts),
      selectedIds: drafts.map((item) => item.id),
      creator: {
        ...(current.creator ?? createEmptyBatchCreatorState()),
        startIndex: String(startIndex + count),
      },
      writeMode: "output-directory",
    }));
    setMode("batch");
    setStatusMessage(
      `Created ${drafts.length} batch draft(s). Choose an output folder to export them.`,
    );
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
          nextSourcePath?: string;
          nextSourceKind?: BatchItem["sourceKind"];
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
          const shouldAdoptOutputPath = sourceItem.sourceKind === "draft";
          itemResults.set(entry.itemId, {
            status: "updated",
            message: shouldAdoptOutputPath
              ? `Created ${getPathLabel(entry.targetPath)}.`
              : `Exported to ${getPathLabel(entry.targetPath)}.`,
            document: entry.document,
            content: entry.content,
            outputPath: shouldAdoptOutputPath ? undefined : entry.targetPath,
            nextSourcePath: shouldAdoptOutputPath ? entry.targetPath : undefined,
            nextSourceKind: shouldAdoptOutputPath ? "file" : undefined,
            updateSavedSnapshot: shouldAdoptOutputPath,
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
                sourcePath: writeResult.nextSourcePath ?? item.sourcePath,
                sourceKind: writeResult.nextSourceKind ?? item.sourceKind,
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

  function updateBatchCreator(mutator: (creator: BatchCreatorState) => BatchCreatorState) {
    updateBatch((current) => ({
      ...current,
      creator: mutator(current.creator ?? createEmptyBatchCreatorState()),
    }));
  }

  function updateBatchItemTextField(
    itemId: string,
    field: "formattedName" | "title" | "role",
    value: string,
  ) {
    updateBatchItemDocument(itemId, (document) => ({
      ...document,
      [field]: value,
    }));
  }

  function updateBatchItemOrganization(itemId: string, value: string) {
    updateBatchItemDocument(itemId, (document) => ({
      ...document,
      organizationUnits: splitSemicolonSeparated(value),
    }));
  }

  function updateBatchItemPrimaryContactValue(
    itemId: string,
    key: PrimaryContactListKey,
    value: string,
  ) {
    updateBatchItemDocument(itemId, (document) => ({
      ...document,
      [key]: updatePrimaryContactValues(document[key], value),
    }));
  }

  function selectOnlyBatchItem(itemId: string) {
    updateBatch((current) => ({
      ...current,
      selectedIds: [itemId],
    }));
  }

  function setBatchItemSelection(itemId: string, checked: boolean) {
    updateBatch((current) => ({
      ...current,
      selectedIds: checked
        ? Array.from(new Set([...current.selectedIds, itemId]))
        : current.selectedIds.filter((id) => id !== itemId),
    }));
  }

  function ensureBatchItemSelected(itemId: string) {
    updateBatch((current) => {
      if (current.selectedIds.includes(itemId)) {
        return current;
      }

      return {
        ...current,
        selectedIds: [...current.selectedIds, itemId],
      };
    });
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
    <main
      className={`app-shell${dragActive ? " app-shell--drag" : ""}`}
      aria-busy={busyLabel ? true : undefined}
    >
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
              {mode === "single" ? "File" : "Batch items"}
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

      <div className="status-bar" role="status" aria-live="polite" aria-atomic="true">
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
              description="Import existing vCards or generate new drafts, then select them for editing, patching and export."
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
                      onChange={(event) => {
                        const search = event.currentTarget.value;
                        updateBatch((current) => ({
                          ...current,
                          search,
                        }));
                      }}
                      placeholder="Search the batch set"
                      autoComplete="off"
                    />
                  </FieldGroup>
                </div>
              </div>

              {batch.items.length > 0 ? (
                <div className="batch-view-row">
                  <div className="mode-tabs batch-view-tabs" role="tablist" aria-label="Batch set view">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={batchViewMode === "overview"}
                      className={`mode-tab${batchViewMode === "overview" ? " mode-tab--active" : ""}`}
                      onClick={() =>
                        updateBatch((current) => ({
                          ...current,
                          viewMode: "overview",
                        }))
                      }
                    >
                      Overview
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={batchViewMode === "power-table"}
                      className={`mode-tab${batchViewMode === "power-table" ? " mode-tab--active" : ""}`}
                      onClick={() =>
                        updateBatch((current) => ({
                          ...current,
                          viewMode: "power-table",
                        }))
                      }
                    >
                      Power user table
                    </button>
                  </div>
                  <p className="batch-view-hint">
                    {batchViewMode === "power-table"
                      ? "Fast inline editing for the visible valid rows. Use it for names, organization, title, role, email, phone and website."
                      : "Switch to the power user table if you want to edit the most important fields for many contacts inline without opening each inspector."}
                  </p>
                </div>
              ) : null}

              {batch.items.length === 0 ? (
                <p className="section-empty">
                  No batch items yet. Import multiple `.vcf` files, load a folder or create fresh drafts to start.
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

                  {batchViewMode === "power-table" ? (
                    <div className="batch-table-scroll">
                      <BatchPowerTable
                        items={visibleBatchItems}
                        selectedIds={batch.selectedIds}
                        onSelectRow={selectOnlyBatchItem}
                        onToggleSelection={setBatchItemSelection}
                        onEnsureSelection={ensureBatchItemSelected}
                        onUpdateFormattedName={(itemId, value) =>
                          updateBatchItemTextField(itemId, "formattedName", value)
                        }
                        onUpdateOrganization={updateBatchItemOrganization}
                        onUpdateEmail={(itemId, value) =>
                          updateBatchItemPrimaryContactValue(itemId, "emails", value)
                        }
                        onUpdatePhone={(itemId, value) =>
                          updateBatchItemPrimaryContactValue(itemId, "phones", value)
                        }
                        onUpdateUrl={(itemId, value) =>
                          updateBatchItemPrimaryContactValue(itemId, "urls", value)
                        }
                        onUpdateTitle={(itemId, value) =>
                          updateBatchItemTextField(itemId, "title", value)
                        }
                        onUpdateRole={(itemId, value) =>
                          updateBatchItemTextField(itemId, "role", value)
                        }
                      />
                    </div>
                  ) : (
                    <div className="batch-table-scroll">
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
                                className={
                                  isSelected
                                    ? "batch-table__row batch-table__row--selected"
                                    : "batch-table__row"
                                }
                                onClick={() => {
                                  if (!document) {
                                    return;
                                  }

                                  selectOnlyBatchItem(item.id);
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

                                      setBatchItemSelection(item.id, event.currentTarget.checked);
                                    }}
                                  />
                                </td>
                                <td>{getPathLabel(item.sourcePath)}</td>
                                <td>{document?.formattedName || "Unreadable file"}</td>
                                <td>{document?.organizationUnits.join("; ") || "—"}</td>
                                <td>{document?.title || "—"}</td>
                                <td>{document?.role || "—"}</td>
                                <td>
                                  <div className="batch-status-cell">
                                    <span
                                      className={`status-pill${item.status === "failed" ? " status-pill--warning" : ""}`}
                                    >
                                      {item.status}
                                    </span>
                                    <span className="batch-status-text">
                                      {getBatchItemStatusText(item, itemIssues)}
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
                </div>
              )}
            </SectionCard>
          </div>

          <aside className="side-column">
            {batch.items.length === 0 ? (
              <SectionCard
                title="Batch workspace"
                description="Import files to edit existing contacts or create new drafts to build a fresh batch."
              >
                <p className="section-empty">
                  One selected valid item opens the full editor here. Multiple selected valid items open the patch builder for shared changes.
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

            <BatchCreatorPanel
              creator={batchCreator}
              onCreatorChange={updateBatchCreator}
              onCreate={handleBatchCreateDrafts}
            />

            <SectionCard
              title="Apply run"
              description="Preview is mandatory before writing. Imported files can be updated in place; new drafts must be exported to an output folder."
            >
              <div className="stack">
                <FieldGroup
                  label="Write mode"
                  hint="In-place creates timestamped backups. Output directory keeps source files untouched."
                >
                  <select
                    value={batch.writeMode}
                    onChange={(event) => {
                      const writeMode = event.currentTarget.value as BatchWriteMode;
                      updateBatch((current) => ({
                        ...current,
                        writeMode,
                      }));
                    }}
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
                  onChange={(event) => {
                    const given = event.currentTarget.value;
                    onPatchChange((current) => ({
                      ...current,
                      name: {
                        ...current.name,
                        value: {
                          ...current.name.value,
                          given,
                        },
                      },
                    }));
                  }}
                />
              </FieldGroup>
              <FieldGroup label="Family name">
                <input
                  value={patch.name.value.family}
                  onChange={(event) => {
                    const family = event.currentTarget.value;
                    onPatchChange((current) => ({
                      ...current,
                      name: {
                        ...current.name,
                        value: {
                          ...current.name.value,
                          family,
                        },
                      },
                    }));
                  }}
                />
              </FieldGroup>
              <FieldGroup label="Additional names">
                <input
                  value={patch.name.value.additional}
                  onChange={(event) => {
                    const additional = event.currentTarget.value;
                    onPatchChange((current) => ({
                      ...current,
                      name: {
                        ...current.name,
                        value: {
                          ...current.name.value,
                          additional,
                        },
                      },
                    }));
                  }}
                />
              </FieldGroup>
              <FieldGroup label="Prefix">
                <input
                  value={patch.name.value.prefix}
                  onChange={(event) => {
                    const prefix = event.currentTarget.value;
                    onPatchChange((current) => ({
                      ...current,
                      name: {
                        ...current.name,
                        value: {
                          ...current.name.value,
                          prefix,
                        },
                      },
                    }));
                  }}
                />
              </FieldGroup>
              <FieldGroup label="Suffix">
                <input
                  value={patch.name.value.suffix}
                  onChange={(event) => {
                    const suffix = event.currentTarget.value;
                    onPatchChange((current) => ({
                      ...current,
                      name: {
                        ...current.name,
                        value: {
                          ...current.name.value,
                          suffix,
                        },
                      },
                    }));
                  }}
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

interface BatchCreatorPanelProps {
  creator: BatchCreatorState;
  onCreatorChange: (mutator: (creator: BatchCreatorState) => BatchCreatorState) => void;
  onCreate: () => void;
}

interface BatchPowerTableProps {
  items: BatchItem[];
  selectedIds: string[];
  onSelectRow: (itemId: string) => void;
  onToggleSelection: (itemId: string, checked: boolean) => void;
  onEnsureSelection: (itemId: string) => void;
  onUpdateFormattedName: (itemId: string, value: string) => void;
  onUpdateOrganization: (itemId: string, value: string) => void;
  onUpdateEmail: (itemId: string, value: string) => void;
  onUpdatePhone: (itemId: string, value: string) => void;
  onUpdateUrl: (itemId: string, value: string) => void;
  onUpdateTitle: (itemId: string, value: string) => void;
  onUpdateRole: (itemId: string, value: string) => void;
}

function BatchPowerTable({
  items,
  selectedIds,
  onSelectRow,
  onToggleSelection,
  onEnsureSelection,
  onUpdateFormattedName,
  onUpdateOrganization,
  onUpdateEmail,
  onUpdatePhone,
  onUpdateUrl,
  onUpdateTitle,
  onUpdateRole,
}: BatchPowerTableProps) {
  return (
    <table className="batch-table batch-table--power">
      <thead>
        <tr>
          <th>Select</th>
          <th>File</th>
          <th>Formatted name</th>
          <th>Email</th>
          <th>Phone</th>
          <th>Website</th>
          <th>Organization</th>
          <th>Title</th>
          <th>Role</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const document = item.document;
          const itemIssues = getBatchItemValidationIssues(item);
          const isSelected = selectedIds.includes(item.id);
          const pathLabel = getPathLabel(item.sourcePath);
          const primaryEmail = getPrimaryContactValue(document?.emails ?? []);
          const primaryPhone = getPrimaryContactValue(document?.phones ?? []);
          const primaryUrl = getPrimaryContactValue(document?.urls ?? []);

          return (
            <tr
              key={item.id}
              className={isSelected ? "batch-table__row batch-table__row--selected" : "batch-table__row"}
              onClick={() => {
                if (!document) {
                  return;
                }

                onSelectRow(item.id);
              }}
            >
              <td>
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={!document}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => {
                    event.stopPropagation();

                    if (!document) {
                      return;
                    }

                    onToggleSelection(item.id, event.currentTarget.checked);
                  }}
                />
              </td>
              <td>{pathLabel}</td>
              <td>
                {document ? (
                  <input
                    className="table-input"
                    value={document.formattedName}
                    aria-label={`Formatted name for ${pathLabel}`}
                    placeholder="Display name"
                    onClick={(event) => event.stopPropagation()}
                    onFocus={() => onEnsureSelection(item.id)}
                    onChange={(event) => onUpdateFormattedName(item.id, event.currentTarget.value)}
                  />
                ) : (
                  "Unreadable file"
                )}
              </td>
              <td>
                {document ? (
                  <input
                    className="table-input"
                    value={primaryEmail?.value ?? ""}
                    aria-label={`Email for ${pathLabel}`}
                    placeholder="name@example.com"
                    onClick={(event) => event.stopPropagation()}
                    onFocus={() => onEnsureSelection(item.id)}
                    onChange={(event) => onUpdateEmail(item.id, event.currentTarget.value)}
                  />
                ) : (
                  "—"
                )}
              </td>
              <td>
                {document ? (
                  <input
                    className="table-input"
                    value={primaryPhone?.value ?? ""}
                    aria-label={`Phone for ${pathLabel}`}
                    placeholder="+49 170 1234567"
                    onClick={(event) => event.stopPropagation()}
                    onFocus={() => onEnsureSelection(item.id)}
                    onChange={(event) => onUpdatePhone(item.id, event.currentTarget.value)}
                  />
                ) : (
                  "—"
                )}
              </td>
              <td>
                {document ? (
                  <input
                    className="table-input"
                    value={primaryUrl?.value ?? ""}
                    aria-label={`Website for ${pathLabel}`}
                    placeholder="https://example.com"
                    onClick={(event) => event.stopPropagation()}
                    onFocus={() => onEnsureSelection(item.id)}
                    onChange={(event) => onUpdateUrl(item.id, event.currentTarget.value)}
                  />
                ) : (
                  "—"
                )}
              </td>
              <td>
                {document ? (
                  <input
                    className="table-input"
                    value={document.organizationUnits.join("; ")}
                    aria-label={`Organization for ${pathLabel}`}
                    placeholder="Organization; Unit"
                    onClick={(event) => event.stopPropagation()}
                    onFocus={() => onEnsureSelection(item.id)}
                    onChange={(event) => onUpdateOrganization(item.id, event.currentTarget.value)}
                  />
                ) : (
                  "—"
                )}
              </td>
              <td>
                {document ? (
                  <input
                    className="table-input"
                    value={document.title}
                    aria-label={`Title for ${pathLabel}`}
                    placeholder="Title"
                    onClick={(event) => event.stopPropagation()}
                    onFocus={() => onEnsureSelection(item.id)}
                    onChange={(event) => onUpdateTitle(item.id, event.currentTarget.value)}
                  />
                ) : (
                  "—"
                )}
              </td>
              <td>
                {document ? (
                  <input
                    className="table-input"
                    value={document.role}
                    aria-label={`Role for ${pathLabel}`}
                    placeholder="Role"
                    onClick={(event) => event.stopPropagation()}
                    onFocus={() => onEnsureSelection(item.id)}
                    onChange={(event) => onUpdateRole(item.id, event.currentTarget.value)}
                  />
                ) : (
                  "—"
                )}
              </td>
              <td>
                <div className="batch-status-cell">
                  <span className={`status-pill${item.status === "failed" ? " status-pill--warning" : ""}`}>
                    {item.status}
                  </span>
                  <span className="batch-status-text">{getBatchItemStatusText(item, itemIssues)}</span>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function BatchCreatorPanel({
  creator,
  onCreatorChange,
  onCreate,
}: BatchCreatorPanelProps) {
  const canCreate = creator.baseName.trim().length > 0;

  return (
    <SectionCard
      title="Batch creator"
      description="Generate numbered draft vCards directly into the batch set, then edit them individually or patch them together."
    >
      <div className="stack">
        <div className="grid grid--two">
          <FieldGroup
            label="Base name"
            hint="Used for both the display name (FN) and the suggested file name slug."
            required
          >
            <input
              value={creator.baseName}
              onChange={(event) => {
                const baseName = event.currentTarget.value;
                onCreatorChange((current) => ({
                  ...current,
                  baseName,
                }));
              }}
              placeholder="Conference Guest"
              autoCapitalize="words"
            />
          </FieldGroup>

          <FieldGroup
            label="Version"
            hint="Choose whether the created drafts start as vCard 3.0 or 4.0."
          >
            <select
              value={creator.version}
              onChange={(event) => {
                const version = event.currentTarget.value as VCardVersion;
                onCreatorChange((current) => ({
                  ...current,
                  version,
                }));
              }}
            >
              <option value="4.0">4.0</option>
              <option value="3.0">3.0</option>
            </select>
          </FieldGroup>

          <FieldGroup
            label="Number of drafts"
            hint="How many numbered contacts should be created in one step."
          >
            <input
              type="number"
              min="1"
              step="1"
              value={creator.count}
              onChange={(event) => {
                const count = event.currentTarget.value;
                onCreatorChange((current) => ({
                  ...current,
                  count,
                }));
              }}
            />
          </FieldGroup>

          <FieldGroup
            label="Start index"
            hint="The first number appended to the base name and file name."
          >
            <input
              type="number"
              min="1"
              step="1"
              value={creator.startIndex}
              onChange={(event) => {
                const startIndex = event.currentTarget.value;
                onCreatorChange((current) => ({
                  ...current,
                  startIndex,
                }));
              }}
            />
          </FieldGroup>
        </div>

        <p className="section-empty">
          Example: <strong>{buildBatchCreatorPreview(creator)}</strong>
        </p>

        <div className="batch-creator-actions">
          <button
            type="button"
            className="button"
            onClick={onCreate}
            disabled={!canCreate}
          >
            Create drafts
          </button>
        </div>
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
    creator: createEmptyBatchCreatorState(),
    viewMode: "overview",
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

function getPrimaryContactValue(values: ContactValue[]): ContactValue | null {
  const primaryIndex = findPrimaryContactIndex(values);
  return primaryIndex >= 0 ? values[primaryIndex] ?? null : null;
}

function updatePrimaryContactValues(values: ContactValue[], value: string): ContactValue[] {
  const primaryIndex = findPrimaryContactIndex(values);
  const hasMeaningfulValue = value.trim().length > 0;

  if (primaryIndex < 0) {
    return hasMeaningfulValue
      ? [
          {
            ...createEmptyContactValue(),
            value,
          },
        ]
      : values;
  }

  if (!hasMeaningfulValue) {
    return values.filter((_, index) => index !== primaryIndex);
  }

  return values.map((entry, index) =>
    index === primaryIndex
      ? {
          ...entry,
          value,
        }
      : entry,
  );
}

function findPrimaryContactIndex(values: ContactValue[]): number {
  let bestIndex = -1;
  let bestScore = Number.POSITIVE_INFINITY;

  values.forEach((entry, index) => {
    const emptinessPenalty = entry.value.trim() ? 0 : 1_000;
    const prefPenalty = entry.pref ?? 100;
    const score = emptinessPenalty + prefPenalty + index / 1000;

    if (score < bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestIndex;
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

function createEmptyBatchCreatorState(): BatchCreatorState {
  return {
    baseName: "",
    count: "3",
    startIndex: "1",
    version: "4.0",
  };
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

function getBatchItemStatusText(item: BatchItem, issues: ReturnType<typeof getBatchItemValidationIssues>): string {
  if (item.statusMessage) {
    return item.statusMessage;
  }

  if (item.parseWarnings.length > 0) {
    return `${item.parseWarnings.length} warning(s)`;
  }

  if (issues.some((issue) => issue.level === "error")) {
    return "Validation errors";
  }

  if (item.sourceKind === "draft") {
    return isBatchItemDirty(item) ? "Draft not exported yet" : "Ready";
  }

  return isBatchItemDirty(item) ? "Unsaved item changes" : "Ready";
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

  return `${slugifyFileName(document.formattedName)}.vcf`;
}

function buildBatchCreatorPreview(creator: BatchCreatorState): string {
  const baseName = creator.baseName.trim() || "Conference Guest";
  const count = parsePositiveInteger(creator.count, 3);
  const startIndex = parsePositiveInteger(creator.startIndex, 1);
  const shouldNumber = count > 1 || startIndex > 1;
  const suffix = shouldNumber ? ` ${startIndex}` : "";
  return `${baseName}${suffix} -> ${slugifyFileName(baseName)}${shouldNumber ? `-${startIndex}` : ""}.vcf`;
}

function parsePositiveInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function slugifyFileName(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return slug || "contact";
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
