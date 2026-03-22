import { describe, expect, it } from "vitest";
import { createEmptyAddressValue, createEmptyDocument } from "./document";
import { validateVCardDocument } from "./validation";

describe("validateVCardDocument", () => {
  it("flags missing formatted name and malformed URLs", () => {
    const document = createEmptyDocument("4.0");
    document.urls.push({
      value: "example.com/profile",
      types: ["work"],
      extraParams: [],
    });

    const issues = validateVCardDocument(document);

    expect(issues.some((issue) => issue.field === "formattedName")).toBe(true);
    expect(issues.some((issue) => issue.field === "urls.0.value")).toBe(true);
  });

  it("warns about empty address rows that would be skipped", () => {
    const document = createEmptyDocument("4.0");
    document.formattedName = "Jane Doe";
    document.addresses.push(createEmptyAddressValue());

    const issues = validateVCardDocument(document);

    expect(issues).toContainEqual(
      expect.objectContaining({
        level: "warning",
        field: "addresses.0",
      }),
    );
  });

  it("warns about empty email and URL rows that would be skipped", () => {
    const document = createEmptyDocument("4.0");
    document.formattedName = "Jane Doe";
    document.emails.push({
      value: "",
      types: ["work"],
      extraParams: [],
    });
    document.urls.push({
      value: "   ",
      types: ["profile"],
      extraParams: [],
    });

    const issues = validateVCardDocument(document);

    expect(issues).toContainEqual(
      expect.objectContaining({
        level: "warning",
        field: "emails.0.value",
      }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({
        level: "warning",
        field: "urls.0.value",
      }),
    );
  });
});
