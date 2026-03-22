import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  chooseOutputDirectoryMock,
  listVcfFilesInDirectoryMock,
  openManyVcfMock,
  openVcfFolderMock,
  openVcfMock,
  readVcfFileMock,
  saveVcfAsMock,
  writeVcfFileMock,
} = vi.hoisted(() => ({
  chooseOutputDirectoryMock: vi.fn(),
  listVcfFilesInDirectoryMock: vi.fn(),
  openManyVcfMock: vi.fn(),
  openVcfFolderMock: vi.fn(),
  openVcfMock: vi.fn(),
  readVcfFileMock: vi.fn(),
  saveVcfAsMock: vi.fn(),
  writeVcfFileMock: vi.fn(),
}));

vi.mock("./lib/file", async () => {
  const actual = await vi.importActual<typeof import("./lib/file")>("./lib/file");

  return {
    ...actual,
    chooseOutputDirectory: chooseOutputDirectoryMock,
    listVcfFilesInDirectory: listVcfFilesInDirectoryMock,
    openManyVcf: openManyVcfMock,
    openVcfFolder: openVcfFolderMock,
    openVcf: openVcfMock,
    readVcfFile: readVcfFileMock,
    saveVcfAs: saveVcfAsMock,
    writeVcfFile: writeVcfFileMock,
  };
});

import App from "./App";

function createVcf(lines: string[]): string {
  return [...lines, ""].join("\r\n");
}

describe("App", () => {
  beforeEach(() => {
    chooseOutputDirectoryMock.mockReset();
    listVcfFilesInDirectoryMock.mockReset();
    openManyVcfMock.mockReset();
    openVcfFolderMock.mockReset();
    openVcfMock.mockReset();
    readVcfFileMock.mockReset();
    saveVcfAsMock.mockReset();
    writeVcfFileMock.mockReset();
  });

  it("renders the empty state before any file is loaded", () => {
    render(<App />);

    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open a vcard file/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start blank/i })).toBeInTheDocument();
  });

  it("allows adding and editing an email entry without crashing", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /start blank/i }));
    const formattedNameInput = await screen.findByLabelText(/^formatted name \(fn\)$/i);

    expect(formattedNameInput).toHaveAttribute("autocomplete", "name");
    expect(formattedNameInput).toBeRequired();

    fireEvent.click(await screen.findByRole("button", { name: /add email/i }));
    const emailInput = screen.getByLabelText(/^value$/i);

    expect(emailInput).toHaveAttribute("type", "email");
    expect(emailInput).toHaveAttribute("autocomplete", "email");
    expect(emailInput).toHaveAttribute("inputmode", "email");
    expect(emailInput).toHaveAccessibleDescription(
      "Use one full email address, for example jane@example.com.",
    );

    fireEvent.change(emailInput, {
      target: { value: "jane@example.com" },
    });

    expect(screen.getByDisplayValue("jane@example.com")).toBeInTheDocument();
    expect(screen.getByText(/EMAIL:jane@example.com/i)).toBeInTheDocument();
  });

  it("supports business-card fields, IM URIs and managed metadata in the editor", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /start blank/i }));
    fireEvent.change(await screen.findByLabelText(/^formatted name \(fn\)$/i), {
      target: { value: "Jane Doe" },
    });
    fireEvent.change(screen.getByLabelText(/^role$/i), {
      target: { value: "Primary client contact" },
    });
    fireEvent.change(screen.getByLabelText(/^birthday$/i), {
      target: { value: "1988-04-12" },
    });

    fireEvent.click(screen.getByRole("button", { name: /add im uri/i }));
    const imppInputs = screen.getAllByLabelText(/^value$/i);
    fireEvent.change(imppInputs[0], {
      target: { value: "sip:jane@example.com" },
    });

    expect(screen.getByText(/ROLE:Primary client contact/i)).toBeInTheDocument();
    expect(screen.getByText(/BDAY:1988-04-12/i)).toBeInTheDocument();
    expect(screen.getByText(/IMPP:sip:jane@example.com/i)).toBeInTheDocument();
    expect(screen.getByText(/^uid$/i)).toBeInTheDocument();
    expect(screen.getByText(/^prodid$/i)).toBeInTheDocument();
    expect(screen.getByText(/^rev$/i)).toBeInTheDocument();
  });

  it("opens a selected vCard file and populates the editor", async () => {
    openVcfMock.mockResolvedValue("/tmp/jane.vcf");
    readVcfFileMock.mockResolvedValue(
      createVcf([
        "BEGIN:VCARD",
        "VERSION:4.0",
        "FN:Jane Doe",
        "EMAIL:jane@example.com",
        "END:VCARD",
      ]),
    );

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /open a vcard file/i }));

    expect(await screen.findByDisplayValue("Jane Doe")).toBeInTheDocument();
    expect(screen.getByDisplayValue("jane@example.com")).toBeInTheDocument();
    expect(screen.getByText(/opened jane\.vcf/i)).toBeInTheDocument();
    expect(readVcfFileMock).toHaveBeenCalledWith("/tmp/jane.vcf");
  });

  it("keeps the empty state when the open dialog is cancelled", async () => {
    openVcfMock.mockResolvedValue(null);

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /open a vcard file/i }));

    await waitFor(() => {
      expect(openVcfMock).toHaveBeenCalled();
    });
    expect(readVcfFileMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
  });

  it("shows a visible error when opening a file fails to parse", async () => {
    openVcfMock.mockResolvedValue("/tmp/broken.vcf");
    readVcfFileMock.mockResolvedValue(
      createVcf([
        "BEGIN:VCARD",
        "VERSION:5.0",
        "FN:Broken Contact",
        "END:VCARD",
      ]),
    );

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /open a vcard file/i }));

    expect(await screen.findByText(/unsupported vcard version: 5\.0/i)).toBeInTheDocument();
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
  });

  it("saves a valid draft through save as and updates the visible file state", async () => {
    saveVcfAsMock.mockResolvedValue("/tmp/jane-doe.vcf");
    writeVcfFileMock.mockResolvedValue(undefined);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /start blank/i }));
    fireEvent.change(await screen.findByLabelText(/^formatted name \(fn\)$/i), {
      target: { value: "Jane Doe" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(writeVcfFileMock).toHaveBeenCalledWith(
        "/tmp/jane-doe.vcf",
        expect.stringContaining("FN:Jane Doe"),
      ),
    );
    expect(screen.getByText(/saved jane-doe\.vcf\./i)).toBeInTheDocument();
    expect(screen.getAllByText("jane-doe.vcf").length).toBeGreaterThan(0);
  });

  it("injects managed metadata when saving an imported contact", async () => {
    openVcfMock.mockResolvedValue("/tmp/imported.vcf");
    readVcfFileMock.mockResolvedValue(
      createVcf([
        "BEGIN:VCARD",
        "VERSION:4.0",
        "FN:Jane Doe",
        "END:VCARD",
      ]),
    );
    writeVcfFileMock.mockResolvedValue(undefined);

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /open a vcard file/i }));
    expect(await screen.findByDisplayValue("Jane Doe")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(writeVcfFileMock).toHaveBeenCalledWith(
        "/tmp/imported.vcf",
        expect.stringMatching(/UID:urn:uuid:/i),
      ),
    );
    expect(writeVcfFileMock.mock.calls[0]?.[1]).toMatch(/PRODID:-\/\/vCard Editor\/\/EN/i);
    expect(writeVcfFileMock.mock.calls[0]?.[1]).toMatch(/REV:\d{4}-\d{2}-\d{2}T/i);
  });

  it("shows a visible error when the save dialog fails for a new draft", async () => {
    saveVcfAsMock.mockRejectedValue(new Error("Dialog failed"));

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /start blank/i }));
    fireEvent.change(await screen.findByLabelText(/^formatted name \(fn\)$/i), {
      target: { value: "Jane Doe" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText(/dialog failed/i)).toBeInTheDocument();
    expect(writeVcfFileMock).not.toHaveBeenCalled();
  });

  it("shows a visible error when writing the file fails during save", async () => {
    saveVcfAsMock.mockResolvedValue("/tmp/jane-doe.vcf");
    writeVcfFileMock.mockRejectedValue(new Error("Disk full"));

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /start blank/i }));
    fireEvent.change(await screen.findByLabelText(/^formatted name \(fn\)$/i), {
      target: { value: "Jane Doe" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText(/disk full/i)).toBeInTheDocument();
    expect(screen.getAllByText("Unsaved draft").length).toBeGreaterThan(0);
  });

  it("blocks save when blocking validation issues remain", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /start blank/i }));
    fireEvent.change(await screen.findByLabelText(/^formatted name \(fn\)$/i), {
      target: { value: "Jane Doe" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add url/i }));
    fireEvent.change(screen.getByLabelText(/^value$/i), {
      target: { value: "example.com/profile" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(
      await screen.findByText(
        /the file still has blocking validation errors and cannot be saved yet\./i,
      ),
    ).toBeInTheDocument();
    expect(saveVcfAsMock).not.toHaveBeenCalled();
    expect(writeVcfFileMock).not.toHaveBeenCalled();
  });

  it("lets the user remove an imported profile image and updates the preview", async () => {
    openVcfMock.mockResolvedValue("/tmp/photo.vcf");
    readVcfFileMock.mockResolvedValue(
      createVcf([
        "BEGIN:VCARD",
        "VERSION:4.0",
        "FN:Photo Person",
        "PHOTO:data:image/png;base64,ZmFrZQ==",
        "END:VCARD",
      ]),
    );

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /open a vcard file/i }));

    expect(await screen.findByAltText(/contact profile/i)).toBeInTheDocument();
    expect(screen.getByText(/PHOTO:data:image\/png;base64,ZmFrZQ==/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /remove image/i }));

    await waitFor(() => {
      expect(screen.queryByAltText(/contact profile/i)).not.toBeInTheDocument();
    });
    expect(screen.queryByText(/PHOTO:data:image\/png;base64,ZmFrZQ==/i)).not.toBeInTheDocument();
  });

  it("switches to batch mode and imports multiple files into the table", async () => {
    openManyVcfMock.mockResolvedValue(["/tmp/alice.vcf", "/tmp/bob.vcf"]);
    readVcfFileMock.mockImplementation(async (path: string) =>
      path.endsWith("alice.vcf")
        ? createVcf([
            "BEGIN:VCARD",
            "VERSION:4.0",
            "FN:Alice Example",
            "ORG:Northwind",
            "END:VCARD",
          ])
        : createVcf([
            "BEGIN:VCARD",
            "VERSION:4.0",
            "FN:Bob Example",
            "TITLE:Sales",
            "END:VCARD",
          ]),
    );

    render(<App />);

    fireEvent.click(screen.getByRole("tab", { name: /^batch$/i }));
    expect(await screen.findByTestId("batch-workspace")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /add files/i }));

    expect(await screen.findByText("Alice Example")).toBeInTheDocument();
    expect(screen.getByText("Bob Example")).toBeInTheDocument();
    expect(screen.getByText(/imported 2 vcard file\(s\) into the batch workspace\./i)).toBeInTheDocument();
  });

  it("imports a folder of vCards in batch mode", async () => {
    openVcfFolderMock.mockResolvedValue("/tmp/contacts");
    listVcfFilesInDirectoryMock.mockResolvedValue(["/tmp/contacts/folder-person.vcf"]);
    readVcfFileMock.mockResolvedValue(
      createVcf([
        "BEGIN:VCARD",
        "VERSION:4.0",
        "FN:Folder Person",
        "END:VCARD",
      ]),
    );

    render(<App />);

    fireEvent.click(screen.getByRole("tab", { name: /^batch$/i }));
    expect(await screen.findByTestId("batch-workspace")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /open folder/i }));

    expect(await screen.findByText("Folder Person")).toBeInTheDocument();
    expect(listVcfFilesInDirectoryMock).toHaveBeenCalledWith("/tmp/contacts");
  });

  it("previews and applies an in-place batch patch with backups", async () => {
    openManyVcfMock.mockResolvedValue(["/tmp/a.vcf", "/tmp/b.vcf"]);
    readVcfFileMock.mockImplementation(async (path: string) =>
      path.endsWith("a.vcf")
        ? createVcf([
            "BEGIN:VCARD",
            "VERSION:4.0",
            "FN:Alice Example",
            "UID:urn:uuid:alice",
            "REV:2026-03-20T08:00:00Z",
            "PRODID:-//vCard Editor//EN",
            "END:VCARD",
          ])
        : createVcf([
            "BEGIN:VCARD",
            "VERSION:4.0",
            "FN:Bob Example",
            "UID:urn:uuid:bob",
            "REV:2026-03-20T08:00:00Z",
            "PRODID:-//vCard Editor//EN",
            "END:VCARD",
          ]),
    );
    writeVcfFileMock.mockResolvedValue(undefined);

    render(<App />);

    fireEvent.click(screen.getByRole("tab", { name: /^batch$/i }));
    expect(await screen.findByTestId("batch-workspace")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /add files/i }));
    expect(await screen.findByText("Alice Example")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/select visible valid files/i));
    expect(await screen.findByRole("heading", { name: /batch patch/i })).toBeInTheDocument();

    const roleSection = screen.getByRole("heading", { name: /^role$/i }).closest("section");
    expect(roleSection).not.toBeNull();
    fireEvent.change(within(roleSection as HTMLElement).getByRole("combobox"), {
      target: { value: "replace" },
    });
    fireEvent.change(within(roleSection as HTMLElement).getByLabelText(/^role$/i), {
      target: { value: "Team Lead" },
    });

    fireEvent.click(screen.getByRole("button", { name: /preview apply/i }));
    expect(await screen.findByText(/preview prepared for 2 file\(s\)\./i)).toBeInTheDocument();
    expect(screen.getByText(/will update a\.vcf in place\./i)).toBeInTheDocument();
    expect(screen.getByText(/will update b\.vcf in place\./i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /apply changes/i }));

    await waitFor(() => {
      expect(writeVcfFileMock).toHaveBeenCalledTimes(4);
    });

    const backupWrites = writeVcfFileMock.mock.calls.filter(([path]) =>
      String(path).includes(".bak.vcf"),
    );
    const targetWrites = writeVcfFileMock.mock.calls.filter(
      ([path]) => String(path).endsWith(".vcf") && !String(path).includes(".bak.vcf"),
    );

    expect(backupWrites).toHaveLength(2);
    expect(targetWrites).toHaveLength(2);
    expect(targetWrites[0]?.[1]).toContain("ROLE:Team Lead");
    expect(targetWrites[1]?.[1]).toContain("ROLE:Team Lead");
    expect(screen.getByText(/applied batch changes to 2 file\(s\) in place\./i)).toBeInTheDocument();
  });
});
