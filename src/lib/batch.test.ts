import { describe, expect, it } from "vitest";
import {
  applyBatchPatch,
  buildBatchPreviewSummary,
  createBatchDraftItems,
  createBatchItem,
  createEmptyBatchPatch,
  createFailedBatchItem,
  createTimestampToken,
  isBatchItemDirty,
  isBatchPatchDirty,
} from "./batch";
import {
  createEmptyContactValue,
  createEmptyDocument,
  serializeVcf,
  touchManagedMetadata,
  type ContactValue,
} from "./vcard";

function createSerializedDocument(
  name: string,
  options: {
    path?: string;
    fixedDate?: Date;
    role?: string;
    uid?: string;
  } = {},
) {
  const document = touchManagedMetadata(
    {
      ...createEmptyDocument("4.0"),
      formattedName: name,
      role: options.role ?? "",
      uid: options.uid ?? "",
    },
    options.fixedDate ?? new Date("2026-03-22T12:00:00Z"),
  );

  return {
    path: options.path ?? `/tmp/${name.toLowerCase().replace(/\s+/gu, "-")}.vcf`,
    document,
    content: serializeVcf(document),
  };
}

function createContactValue(value: string, type = "work"): ContactValue {
  return {
    ...createEmptyContactValue(),
    value,
    types: [type],
  };
}

describe("batch helpers", () => {
  it("creates parsed batch items and tracks dirty state against the saved snapshot", () => {
    const { path, content } = createSerializedDocument("Jane Doe");
    const item = createBatchItem(path, content);

    expect(item.document?.formattedName).toBe("Jane Doe");
    expect(item.persistedContent).toBe(content);
    expect(item.savedSnapshot).toContain("FN:Jane Doe");
    expect(isBatchItemDirty(item)).toBe(false);

    const dirtyItem = {
      ...item,
      document: item.document
        ? {
            ...item.document,
            role: "Primary contact",
          }
        : null,
    };

    expect(isBatchItemDirty(dirtyItem)).toBe(true);
  });

  it("keeps freshly imported files clean when managed metadata is still missing", () => {
    const content = serializeVcf({
      ...createEmptyDocument("4.0"),
      formattedName: "Metadata Later",
    });
    const item = createBatchItem("/tmp/metadata-later.vcf", content);

    expect(item.document?.uid).toBe("");
    expect(item.document?.prodId).toBe("");
    expect(isBatchItemDirty(item)).toBe(false);

    const preview = buildBatchPreviewSummary([item], [item.id], {
      writeMode: "in-place",
      timestamp: new Date("2026-03-23T08:15:00Z"),
    });

    expect(preview.writeCount).toBe(0);
    expect(preview.skipCount).toBe(1);
    expect(preview.entries[0]?.reason).toMatch(/no changes to write/i);
  });

  it("creates numbered draft batch items that require export before they exist on disk", () => {
    const items = createBatchDraftItems({
      baseName: "Conference Guest",
      count: 2,
      startIndex: 4,
      version: "3.0",
    });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      sourceKind: "draft",
      sourcePath: "conference-guest-4.vcf",
      savedSnapshot: "",
    });
    expect(items[0]?.document?.formattedName).toBe("Conference Guest 4");
    expect(items[0]?.document?.version).toBe("3.0");
    expect(isBatchItemDirty(items[0]!)).toBe(true);
    expect(items[1]?.sourcePath).toBe("conference-guest-5.vcf");
  });

  it("detects when a batch patch actually changes something", () => {
    const patch = createEmptyBatchPatch();

    expect(isBatchPatchDirty(patch)).toBe(false);

    patch.role = {
      mode: "replace",
      value: "Account owner",
    };

    expect(isBatchPatchDirty(patch)).toBe(true);
  });

  it("applies scalar, list and photo patch operations without mutating the source document", () => {
    const source = touchManagedMetadata({
      ...createEmptyDocument("4.0"),
      formattedName: "Jane Doe",
      organizationUnits: ["Acme GmbH"],
      emails: [createContactValue("jane@acme.test")],
      photo: {
        uri: "data:image/png;base64,b2xk",
        mediaType: "image/png",
        isEmbedded: true,
      },
    });

    const patch = createEmptyBatchPatch();
    patch.role = {
      mode: "replace",
      value: "Primary contact",
    };
    patch.organizationUnits = {
      mode: "replace",
      value: ["Northwind", "Sales"],
    };
    patch.emails = {
      mode: "append",
      value: [createContactValue("jane.doe@northwind.test", "home")],
    };
    patch.photo = {
      mode: "replace",
      value: {
        uri: "data:image/jpeg;base64,bmV3",
        mediaType: "image/jpeg",
        isEmbedded: true,
      },
    };

    const next = applyBatchPatch(source, patch);

    expect(next.role).toBe("Primary contact");
    expect(next.organizationUnits).toEqual(["Northwind", "Sales"]);
    expect(next.emails.map((entry) => entry.value)).toEqual([
      "jane@acme.test",
      "jane.doe@northwind.test",
    ]);
    expect(next.photo?.mediaType).toBe("image/jpeg");
    expect(next.uid).toBeTruthy();
    expect(next.prodId).toBeTruthy();
    expect(source.organizationUnits).toEqual(["Acme GmbH"]);
    expect(source.emails).toHaveLength(1);
    expect(source.photo?.mediaType).toBe("image/png");
  });

  it("builds an in-place preview with deterministic backup paths", () => {
    const fixedDate = new Date("2026-03-23T08:15:00Z");
    const { path, content } = createSerializedDocument("Alice Example", {
      path: "/tmp/alice.vcf",
      fixedDate,
      uid: "urn:uuid:alice",
    });
    const item = createBatchItem(path, content);
    const patch = createEmptyBatchPatch();
    patch.role = {
      mode: "replace",
      value: "Team lead",
    };

    const preview = buildBatchPreviewSummary([item], [item.id], {
      patch,
      writeMode: "in-place",
      timestamp: fixedDate,
    });

    expect(preview.writeCount).toBe(1);
    expect(preview.skipCount).toBe(0);
    expect(preview.entries[0]).toMatchObject({
      action: "write",
      sourcePath: "/tmp/alice.vcf",
      targetPath: "/tmp/alice.vcf",
      backupPath: `/tmp/alice.${createTimestampToken(fixedDate)}.bak.vcf`,
    });
    expect(preview.entries[0]?.content).toContain("ROLE:Team lead");
    expect(preview.entries[0]?.content).toContain("REV:2026-03-23T08:15:00Z");
  });

  it("deduplicates output paths and skips unreadable files during output-folder previews", () => {
    const fixedDate = new Date("2026-03-23T08:15:00Z");
    const first = createBatchItem(
      "/tmp/alpha/contact.vcf",
      createSerializedDocument("Alpha Contact", {
        fixedDate,
        path: "/tmp/alpha/contact.vcf",
        uid: "urn:uuid:alpha",
      }).content,
    );
    const second = createBatchItem(
      "/tmp/beta/contact.vcf",
      createSerializedDocument("Beta Contact", {
        fixedDate,
        path: "/tmp/beta/contact.vcf",
        uid: "urn:uuid:beta",
      }).content,
    );
    const failed = createFailedBatchItem("/tmp/broken.vcf", "Broken file");
    const patch = createEmptyBatchPatch();
    patch.title = {
      mode: "replace",
      value: "Sales",
    };

    const preview = buildBatchPreviewSummary([first, second, failed], [first.id, second.id, failed.id], {
      patch,
      writeMode: "output-directory",
      outputDirectory: "/tmp/export",
      timestamp: fixedDate,
    });

    expect(preview.writeCount).toBe(2);
    expect(preview.skipCount).toBe(1);
    expect(preview.entries.filter((entry) => entry.action === "write").map((entry) => entry.targetPath)).toEqual([
      "/tmp/export/contact.vcf",
      "/tmp/export/contact-2.vcf",
    ]);
    expect(preview.entries.find((entry) => entry.itemId === failed.id)?.reason).toMatch(
      /could not be parsed/i,
    );
  });

  it("forces draft batch items to use an output directory instead of in-place writes", () => {
    const [draft] = createBatchDraftItems({
      baseName: "Launch Contact",
      count: 1,
    });

    const inPlacePreview = buildBatchPreviewSummary([draft], [draft.id], {
      writeMode: "in-place",
      timestamp: new Date("2026-03-23T08:15:00Z"),
    });

    expect(inPlacePreview.writeCount).toBe(0);
    expect(inPlacePreview.skipCount).toBe(1);
    expect(inPlacePreview.entries[0]?.reason).toMatch(/exported to an output folder/i);

    const outputPreview = buildBatchPreviewSummary([draft], [draft.id], {
      writeMode: "output-directory",
      outputDirectory: "/tmp/export",
      timestamp: new Date("2026-03-23T08:15:00Z"),
    });

    expect(outputPreview.writeCount).toBe(1);
    expect(outputPreview.entries[0]).toMatchObject({
      action: "write",
      sourcePath: "launch-contact.vcf",
      targetPath: "/tmp/export/launch-contact.vcf",
    });
  });

  it("skips unchanged files when previewing without an actual mutation", () => {
    const fixedDate = new Date("2026-03-23T08:15:00Z");
    const { path, content } = createSerializedDocument("No Change", {
      path: "/tmp/no-change.vcf",
      fixedDate,
      uid: "urn:uuid:no-change",
    });
    const item = createBatchItem(path, content);

    const preview = buildBatchPreviewSummary([item], [item.id], {
      writeMode: "in-place",
      timestamp: fixedDate,
    });

    expect(preview.writeCount).toBe(0);
    expect(preview.skipCount).toBe(1);
    expect(preview.entries[0]?.reason).toMatch(/no changes to write/i);
  });
});
