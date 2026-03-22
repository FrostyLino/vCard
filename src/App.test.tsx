import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { openVcfMock, readVcfFileMock, saveVcfAsMock, writeVcfFileMock } = vi.hoisted(() => ({
  openVcfMock: vi.fn(),
  readVcfFileMock: vi.fn(),
  saveVcfAsMock: vi.fn(),
  writeVcfFileMock: vi.fn(),
}));

vi.mock("./lib/file", async () => {
  const actual = await vi.importActual<typeof import("./lib/file")>("./lib/file");

  return {
    ...actual,
    openVcf: openVcfMock,
    readVcfFile: readVcfFileMock,
    saveVcfAs: saveVcfAsMock,
    writeVcfFile: writeVcfFileMock,
  };
});

import App from "./App";

describe("App", () => {
  beforeEach(() => {
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

  it("opens a selected vCard file and populates the editor", async () => {
    openVcfMock.mockResolvedValue("/tmp/jane.vcf");
    readVcfFileMock.mockResolvedValue(
      [
        "BEGIN:VCARD",
        "VERSION:4.0",
        "FN:Jane Doe",
        "EMAIL:jane@example.com",
        "END:VCARD",
        "",
      ].join("\r\n"),
    );

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /open a vcard file/i }));

    expect(await screen.findByDisplayValue("Jane Doe")).toBeInTheDocument();
    expect(screen.getByDisplayValue("jane@example.com")).toBeInTheDocument();
    expect(screen.getByText(/opened jane\.vcf/i)).toBeInTheDocument();
    expect(readVcfFileMock).toHaveBeenCalledWith("/tmp/jane.vcf");
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
      [
        "BEGIN:VCARD",
        "VERSION:4.0",
        "FN:Photo Person",
        "PHOTO:data:image/png;base64,ZmFrZQ==",
        "END:VCARD",
        "",
      ].join("\r\n"),
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
});
