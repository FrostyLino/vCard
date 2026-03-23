import {
  createEmptyDocument,
  ensureManagedMetadata,
  parseVcf,
  serializeVcf,
  touchManagedMetadata,
  validateVCardDocument,
  type AddressValue,
  type ContactValue,
  type ParseResult,
  type PhotoValue,
  type StructuredName,
  type ValidationIssue,
  type VCardDocument,
  type VCardVersion,
} from "./vcard";

export type BatchItemStatus = "ready" | "updated" | "skipped" | "failed";
export type BatchItemSourceKind = "file" | "draft";
export type BatchWriteMode = "in-place" | "output-directory";
export type ScalarPatchMode = "keep" | "replace" | "clear";
export type ListPatchMode = "keep" | "replace" | "append" | "clear";
export type PhotoPatchMode = "keep" | "replace" | "clear";

export interface BatchItem {
  id: string;
  sourcePath: string;
  sourceKind: BatchItemSourceKind;
  document: VCardDocument | null;
  savedSnapshot: string;
  persistedContent: string;
  parseWarnings: string[];
  status: BatchItemStatus;
  statusMessage?: string;
  lastOutputPath?: string;
}

export interface ScalarPatch<T> {
  mode: ScalarPatchMode;
  value: T;
}

export interface ListPatch<T> {
  mode: ListPatchMode;
  value: T[];
}

export interface PhotoPatch {
  mode: PhotoPatchMode;
  value: PhotoValue | null;
}

export interface BatchPatch {
  formattedName: ScalarPatch<string>;
  name: ScalarPatch<StructuredName>;
  nicknames: ListPatch<string>;
  organizationUnits: ListPatch<string>;
  title: ScalarPatch<string>;
  role: ScalarPatch<string>;
  birthday: ScalarPatch<string>;
  anniversary: ScalarPatch<string>;
  photo: PhotoPatch;
  emails: ListPatch<ContactValue>;
  phones: ListPatch<ContactValue>;
  urls: ListPatch<ContactValue>;
  impps: ListPatch<ContactValue>;
  addresses: ListPatch<AddressValue>;
  note: ScalarPatch<string>;
  uid: ScalarPatch<string>;
  prodId: ScalarPatch<string>;
}

export interface BatchPreviewEntry {
  itemId: string;
  sourcePath: string;
  targetPath: string;
  backupPath?: string;
  document: VCardDocument | null;
  content: string;
  action: "write" | "skip";
  reason?: string;
  issues: ValidationIssue[];
}

export interface BatchPreviewSummary {
  entries: BatchPreviewEntry[];
  writeCount: number;
  skipCount: number;
  errorCount: number;
}

export interface BatchDraftCreationOptions {
  baseName: string;
  count: number;
  startIndex?: number;
  version?: VCardVersion;
}

export function createBatchItem(sourcePath: string, content: string): BatchItem {
  const result = parseVcf(content);
  return toBatchItem(sourcePath, content, result);
}

export function createFailedBatchItem(sourcePath: string, error: string): BatchItem {
  return {
    id: sourcePath,
    sourcePath,
    sourceKind: "file",
    document: null,
    savedSnapshot: "",
    persistedContent: "",
    parseWarnings: [],
    status: "failed",
    statusMessage: error,
  };
}

export function createBatchDraftItems({
  baseName,
  count,
  startIndex = 1,
  version = "4.0",
}: BatchDraftCreationOptions): BatchItem[] {
  const normalizedBaseName = baseName.trim();
  const normalizedCount = Math.max(1, Math.floor(count));
  const normalizedStartIndex = Math.max(1, Math.floor(startIndex));
  const slugBaseName = slugifyDraftName(normalizedBaseName) || "contact";

  return Array.from({ length: normalizedCount }, (_, offset) => {
    const sequence = normalizedStartIndex + offset;
    const shouldNumber = normalizedCount > 1 || normalizedStartIndex > 1;
    const formattedName = shouldNumber
      ? `${normalizedBaseName} ${sequence}`
      : normalizedBaseName;
    const fileName = shouldNumber
      ? `${slugBaseName}-${sequence}.vcf`
      : `${slugBaseName}.vcf`;
    const document = touchManagedMetadata({
      ...createEmptyDocument(version),
      formattedName,
    });

    return {
      id: createBatchDraftId(),
      sourcePath: fileName,
      sourceKind: "draft",
      document,
      savedSnapshot: "",
      persistedContent: "",
      parseWarnings: [],
      status: "ready",
    };
  });
}

export function getBatchItemValidationIssues(item: BatchItem): ValidationIssue[] {
  return item.document ? validateVCardDocument(item.document) : [];
}

export function getBatchItemSerialized(item: BatchItem): string {
  return item.document ? serializeVcf(item.document) : "";
}

export function isBatchItemDirty(item: BatchItem): boolean {
  return Boolean(item.document) && getBatchItemSerialized(item) !== item.savedSnapshot;
}

export function createEmptyBatchPatch(): BatchPatch {
  return {
    formattedName: createScalarPatch(""),
    name: createScalarPatch({
      family: "",
      given: "",
      additional: "",
      prefix: "",
      suffix: "",
    }),
    nicknames: createListPatch<string>(),
    organizationUnits: createListPatch<string>(),
    title: createScalarPatch(""),
    role: createScalarPatch(""),
    birthday: createScalarPatch(""),
    anniversary: createScalarPatch(""),
    photo: {
      mode: "keep",
      value: null,
    },
    emails: createListPatch<ContactValue>(),
    phones: createListPatch<ContactValue>(),
    urls: createListPatch<ContactValue>(),
    impps: createListPatch<ContactValue>(),
    addresses: createListPatch<AddressValue>(),
    note: createScalarPatch(""),
    uid: createScalarPatch(""),
    prodId: createScalarPatch(""),
  };
}

export function isBatchPatchDirty(patch: BatchPatch): boolean {
  return [
    patch.formattedName.mode,
    patch.name.mode,
    patch.nicknames.mode,
    patch.organizationUnits.mode,
    patch.title.mode,
    patch.role.mode,
    patch.birthday.mode,
    patch.anniversary.mode,
    patch.photo.mode,
    patch.emails.mode,
    patch.phones.mode,
    patch.urls.mode,
    patch.impps.mode,
    patch.addresses.mode,
    patch.note.mode,
    patch.uid.mode,
    patch.prodId.mode,
  ].some((mode) => mode !== "keep");
}

export function applyBatchPatch(document: VCardDocument, patch: BatchPatch): VCardDocument {
  let nextDocument = ensureManagedMetadata(document);

  nextDocument = {
    ...nextDocument,
    formattedName: applyScalarPatch(nextDocument.formattedName, patch.formattedName),
    name: applyStructuredNamePatch(nextDocument.name, patch.name),
    nicknames: applyListPatch(nextDocument.nicknames, patch.nicknames),
    organizationUnits: applyListPatch(nextDocument.organizationUnits, patch.organizationUnits),
    title: applyScalarPatch(nextDocument.title, patch.title),
    role: applyScalarPatch(nextDocument.role, patch.role),
    birthday: applyScalarPatch(nextDocument.birthday, patch.birthday),
    anniversary: applyScalarPatch(nextDocument.anniversary, patch.anniversary),
    photo: applyPhotoPatch(nextDocument.photo, patch.photo),
    emails: applyObjectListPatch(nextDocument.emails, patch.emails),
    phones: applyObjectListPatch(nextDocument.phones, patch.phones),
    urls: applyObjectListPatch(nextDocument.urls, patch.urls),
    impps: applyObjectListPatch(nextDocument.impps, patch.impps),
    addresses: applyObjectListPatch(nextDocument.addresses, patch.addresses),
    note: applyScalarPatch(nextDocument.note, patch.note),
    uid: applyScalarPatch(nextDocument.uid, patch.uid),
    prodId: applyScalarPatch(nextDocument.prodId, patch.prodId),
  };

  return ensureManagedMetadata(nextDocument);
}

export function buildBatchPreviewSummary(
  items: BatchItem[],
  selectedIds: string[],
  options: {
    patch?: BatchPatch | null;
    writeMode: BatchWriteMode;
    outputDirectory?: string | null;
    timestamp?: Date;
  },
): BatchPreviewSummary {
  const selectedItems = items.filter((item) => selectedIds.includes(item.id));
  const timestampToken = createTimestampToken(options.timestamp ?? new Date());
  const usedOutputPaths = new Set<string>();

  const entries = selectedItems.map((item) => {
    if (!item.document) {
      return createSkippedEntry(item, "The file could not be parsed and cannot be written.");
    }

    if (item.sourceKind === "draft" && options.writeMode === "in-place") {
      return createSkippedEntry(item, "Draft items must be exported to an output folder.");
    }

    const baseDocument = options.patch ? applyBatchPatch(item.document, options.patch) : item.document;
    const baseContent = serializeVcf(baseDocument);

    if (item.sourceKind === "file" && baseContent === item.savedSnapshot) {
      return createSkippedEntry(item, "No changes to write.");
    }

    const documentToWrite = touchManagedMetadata(baseDocument, options.timestamp ?? new Date());
    const issues = validateVCardDocument(documentToWrite);

    if (issues.some((issue) => issue.level === "error")) {
      return createSkippedEntry(item, "Blocking validation errors remain.", issues);
    }

    const content = serializeVcf(documentToWrite);

    const targetPath =
      options.writeMode === "output-directory"
        ? resolveOutputPath(item.sourcePath, options.outputDirectory ?? "", usedOutputPaths)
        : item.sourcePath;

    if (!targetPath) {
      return createSkippedEntry(item, "Choose an output directory before applying.", issues);
    }

    return {
      itemId: item.id,
      sourcePath: item.sourcePath,
      targetPath,
      backupPath:
        options.writeMode === "in-place"
          ? buildBackupPath(item.sourcePath, timestampToken)
          : undefined,
      document: documentToWrite,
      content,
      action: "write" as const,
      issues,
    };
  });

  return {
    entries,
    writeCount: entries.filter((entry) => entry.action === "write").length,
    skipCount: entries.filter((entry) => entry.action === "skip").length,
    errorCount: entries.filter((entry) => entry.reason?.toLowerCase().includes("error")).length,
  };
}

export function createTimestampToken(now = new Date()): string {
  return now.toISOString().replace(/[:]/gu, "-").replace(/\.\d{3}Z$/u, "Z");
}

function toBatchItem(sourcePath: string, content: string, result: ParseResult): BatchItem {
  return {
    id: sourcePath,
    sourcePath,
    sourceKind: "file",
    document: result.document,
    savedSnapshot: serializeVcf(result.document),
    persistedContent: content,
    parseWarnings: result.warnings,
    status: "ready",
  };
}

function createScalarPatch<T>(value: T): ScalarPatch<T> {
  return {
    mode: "keep",
    value,
  };
}

function createListPatch<T>(): ListPatch<T> {
  return {
    mode: "keep",
    value: [],
  };
}

function applyScalarPatch(current: string, patch: ScalarPatch<string>): string {
  switch (patch.mode) {
    case "keep":
      return current;
    case "replace":
      return patch.value;
    case "clear":
      return "";
  }
}

function applyStructuredNamePatch(
  current: StructuredName,
  patch: ScalarPatch<StructuredName>,
): StructuredName {
  switch (patch.mode) {
    case "keep":
      return current;
    case "replace":
      return { ...patch.value };
    case "clear":
      return {
        family: "",
        given: "",
        additional: "",
        prefix: "",
        suffix: "",
      };
  }
}

function applyPhotoPatch(current: PhotoValue | null, patch: PhotoPatch): PhotoValue | null {
  switch (patch.mode) {
    case "keep":
      return current;
    case "replace":
      return patch.value ? { ...patch.value } : null;
    case "clear":
      return null;
  }
}

function applyListPatch(current: string[], patch: ListPatch<string>): string[] {
  switch (patch.mode) {
    case "keep":
      return current;
    case "replace":
      return [...patch.value];
    case "append":
      return [...current, ...patch.value];
    case "clear":
      return [];
  }
}

function applyObjectListPatch<T extends ContactValue | AddressValue>(
  current: T[],
  patch: ListPatch<T>,
): T[] {
  switch (patch.mode) {
    case "keep":
      return current;
    case "replace":
      return patch.value.map(cloneObjectEntry);
    case "append":
      return [...current, ...patch.value.map(cloneObjectEntry)];
    case "clear":
      return [];
  }
}

function cloneObjectEntry<T extends ContactValue | AddressValue>(entry: T): T {
  return {
    ...entry,
    types: [...entry.types],
    extraParams: entry.extraParams.map((param) => ({
      key: param.key,
      values: [...param.values],
    })),
  };
}

function createSkippedEntry(
  item: BatchItem,
  reason: string,
  issues: ValidationIssue[] = [],
): BatchPreviewEntry {
  return {
    itemId: item.id,
    sourcePath: item.sourcePath,
    targetPath: item.sourcePath,
    document: item.document,
    content: item.document ? serializeVcf(item.document) : "",
    action: "skip",
    reason,
    issues,
  };
}

function resolveOutputPath(
  sourcePath: string,
  outputDirectory: string,
  usedOutputPaths: Set<string>,
): string {
  if (!outputDirectory) {
    return "";
  }

  const separator = outputDirectory.endsWith("/") || outputDirectory.endsWith("\\") ? "" : "/";
  const fileName = sourcePath.split(/[\\/]/u).pop() ?? "contact.vcf";
  const baseName = fileName.replace(/\.vcf$/iu, "");

  let attempt = `${outputDirectory}${separator}${fileName}`;
  let duplicateIndex = 2;

  while (usedOutputPaths.has(attempt)) {
    attempt = `${outputDirectory}${separator}${baseName}-${duplicateIndex}.vcf`;
    duplicateIndex += 1;
  }

  usedOutputPaths.add(attempt);
  return attempt;
}

function buildBackupPath(sourcePath: string, timestampToken: string): string {
  const extensionlessPath = sourcePath.replace(/\.vcf$/iu, "");
  return `${extensionlessPath}.${timestampToken}.bak.vcf`;
}

function createBatchDraftId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `draft:${crypto.randomUUID()}`;
  }

  return `draft:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function slugifyDraftName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}
