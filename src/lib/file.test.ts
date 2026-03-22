import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, openMock, saveMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  openMock: vi.fn(),
  saveMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: openMock,
  save: saveMock,
}));

import {
  ensureVcfExtension,
  getPathLabel,
  openVcf,
  readVcfFile,
  saveVcfAs,
  writeVcfFile,
} from "./file";

describe("file helpers", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    openMock.mockReset();
    saveMock.mockReset();
  });

  it("opens a single vcf path and normalizes dialog array responses", async () => {
    openMock.mockResolvedValue(["/tmp/jane.vcf"]);

    await expect(openVcf()).resolves.toBe("/tmp/jane.vcf");
    expect(openMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Open vCard file",
        multiple: false,
        fileAccessMode: "scoped",
        filters: [{ name: "vCard", extensions: ["vcf"] }],
      }),
    );
  });

  it("saves with a guaranteed .vcf suffix and returns null on cancel", async () => {
    saveMock.mockResolvedValueOnce("/tmp/contact").mockResolvedValueOnce(null);

    await expect(saveVcfAs("/tmp/jane")).resolves.toBe("/tmp/contact.vcf");
    await expect(saveVcfAs("/tmp/jane")).resolves.toBeNull();
    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Save vCard file",
        defaultPath: "/tmp/jane.vcf",
      }),
    );
  });

  it("invokes the Tauri commands for reading and writing", async () => {
    invokeMock.mockResolvedValueOnce("BEGIN:VCARD\r\nEND:VCARD\r\n").mockResolvedValueOnce(undefined);

    await expect(readVcfFile("/tmp/jane.vcf")).resolves.toContain("BEGIN:VCARD");
    await writeVcfFile("/tmp/jane.vcf", "content");

    expect(invokeMock).toHaveBeenNthCalledWith(1, "read_vcf_file", { path: "/tmp/jane.vcf" });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "write_vcf_file", {
      path: "/tmp/jane.vcf",
      content: "content",
    });
  });

  it("handles path helpers consistently across Unix and Windows-like paths", () => {
    expect(ensureVcfExtension("/tmp/contact")).toBe("/tmp/contact.vcf");
    expect(ensureVcfExtension("/tmp/contact.VCF")).toBe("/tmp/contact.VCF");
    expect(getPathLabel(null)).toBe("Unsaved draft");
    expect(getPathLabel("/tmp/demo/contact.vcf")).toBe("contact.vcf");
    expect(getPathLabel(String.raw`C:\Users\Lino\contact.vcf`)).toBe("contact.vcf");
  });
});
