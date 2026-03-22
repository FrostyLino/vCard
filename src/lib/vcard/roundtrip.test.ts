import { describe, expect, it } from "vitest";
import { parseVcf } from "./parser";
import { serializeVcf } from "./serializer";

describe("complex vCard roundtrips", () => {
  it("roundtrips mixed known fields, Apple labels, parameter labels and unknown properties", () => {
    const source = [
      "BEGIN:VCARD",
      "VERSION:4.0",
      "FN:Jane Doe",
      "N:Doe;Jane;;;",
      "NICKNAME:JD,Janey",
      "ORG:Acme GmbH;Product",
      "TITLE:Design Lead",
      "item1.EMAIL;TYPE=WORK;PREF=1:jane@example.com",
      "item1.X-ABLabel:Primary Work",
      'URL;LABEL="Public profile":https://example.com/jane',
      'ADR;LABEL="Front desk":;;Street 1;Berlin;;;Germany',
      "PHOTO:data:image/png;base64,ZmFrZQ==",
      "NOTE:Line one\\nLine two",
      "X-CUSTOM;TYPE=demo:value",
      "END:VCARD",
      "",
    ].join("\r\n");

    const initial = parseVcf(source);
    const roundtrip = parseVcf(serializeVcf(initial.document));

    expect(roundtrip.warnings).toHaveLength(0);
    expect(roundtrip.document.formattedName).toBe("Jane Doe");
    expect(roundtrip.document.nicknames).toEqual(["JD", "Janey"]);
    expect(roundtrip.document.organizationUnits).toEqual(["Acme GmbH", "Product"]);
    expect(roundtrip.document.title).toBe("Design Lead");
    expect(roundtrip.document.emails[0]).toMatchObject({
      value: "jane@example.com",
      group: "item1",
      pref: 1,
      label: "Primary Work",
    });
    expect(roundtrip.document.urls[0]).toMatchObject({
      value: "https://example.com/jane",
      label: "Public profile",
    });
    expect(roundtrip.document.addresses[0]).toMatchObject({
      street: "Street 1",
      locality: "Berlin",
      country: "Germany",
      label: "Front desk",
    });
    expect(roundtrip.document.photo?.uri).toBe("data:image/png;base64,ZmFrZQ==");
    expect(roundtrip.document.note).toBe("Line one\nLine two");
    expect(roundtrip.document.unknownProperties).toContainEqual(
      expect.objectContaining({
        name: "X-CUSTOM",
        value: "value",
      }),
    );
  });

  it("preserves unmatched Apple labels as unknown properties", () => {
    const source = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Jane Doe",
      "item42.X-ABLabel:Detached label",
      "END:VCARD",
      "",
    ].join("\r\n");

    const result = parseVcf(source);

    expect(result.document.unknownProperties).toContainEqual(
      expect.objectContaining({
        group: "item42",
        name: "X-ABLabel",
        value: "Detached label",
      }),
    );
  });

  it("preserves Apple address metadata properties it does not interpret yet", () => {
    const source = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Jane Doe",
      "item1.ADR;TYPE=HOME:;;Street 1;Berlin;;;Germany",
      "item1.X-ABADR:de",
      "END:VCARD",
      "",
    ].join("\r\n");

    const serialized = serializeVcf(parseVcf(source).document);

    expect(serialized).toContain("item1.ADR;TYPE=HOME:;;Street 1;Berlin;;;Germany");
    expect(serialized).toContain("item1.X-ABADR:de");
  });
});
