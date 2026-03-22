import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
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
});
