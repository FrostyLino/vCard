import { describe, expect, it } from "vitest";
import {
  createEmptyAddressValue,
  createEmptyContactValue,
  createEmptyDocument,
  createEmptyStructuredName,
} from "./document";

describe("document factories", () => {
  it("creates empty structured values with the expected defaults", () => {
    expect(createEmptyStructuredName()).toEqual({
      family: "",
      given: "",
      additional: "",
      prefix: "",
      suffix: "",
    });
    expect(createEmptyContactValue()).toEqual({
      value: "",
      types: [],
      extraParams: [],
    });
    expect(createEmptyAddressValue()).toEqual({
      poBox: "",
      extended: "",
      street: "",
      locality: "",
      region: "",
      postalCode: "",
      country: "",
      types: [],
      extraParams: [],
    });
  });

  it("creates empty documents with the default 4.0 version and empty collections", () => {
    const document = createEmptyDocument();

    expect(document.version).toBe("4.0");
    expect(document.formattedName).toBe("");
    expect(document.photo).toBeNull();
    expect(document.name).toEqual(createEmptyStructuredName());
    expect(document.nicknames).toEqual([]);
    expect(document.organizationUnits).toEqual([]);
    expect(document.emails).toEqual([]);
    expect(document.phones).toEqual([]);
    expect(document.urls).toEqual([]);
    expect(document.addresses).toEqual([]);
    expect(document.unknownProperties).toEqual([]);
  });

  it("respects explicit versions and returns fresh mutable objects each time", () => {
    const first = createEmptyDocument("3.0");
    const second = createEmptyDocument("3.0");

    first.nicknames.push("Jane");
    first.emails.push(createEmptyContactValue());
    first.addresses.push(createEmptyAddressValue());
    first.name.given = "Jane";

    expect(first.version).toBe("3.0");
    expect(second.version).toBe("3.0");
    expect(second.nicknames).toEqual([]);
    expect(second.emails).toEqual([]);
    expect(second.addresses).toEqual([]);
    expect(second.name.given).toBe("");
  });
});
