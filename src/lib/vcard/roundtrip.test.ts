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
      "ROLE:Primary client contact",
      "BDAY:1988-04-12",
      "ANNIVERSARY:2018-09-01",
      "item1.EMAIL;TYPE=WORK;PREF=1:jane@example.com",
      "item1.X-ABLabel:Primary Work",
      'URL;LABEL="Public profile":https://example.com/jane',
      "IMPP;TYPE=WORK;PREF=1:sip:jane@example.com",
      'ADR;LABEL="Front desk":;;Street 1;Berlin;;;Germany',
      "PHOTO:data:image/png;base64,ZmFrZQ==",
      "NOTE:Line one\\nLine two",
      "UID:urn:uuid:12345678-1234-4234-9234-123456789abc",
      "REV:2026-03-22T10:11:12Z",
      "PRODID:-//Example App//EN",
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
    expect(roundtrip.document.role).toBe("Primary client contact");
    expect(roundtrip.document.birthday).toBe("1988-04-12");
    expect(roundtrip.document.anniversary).toBe("2018-09-01");
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
    expect(roundtrip.document.impps[0]).toMatchObject({
      value: "sip:jane@example.com",
      pref: 1,
    });
    expect(roundtrip.document.addresses[0]).toMatchObject({
      street: "Street 1",
      locality: "Berlin",
      country: "Germany",
      label: "Front desk",
    });
    expect(roundtrip.document.photo?.uri).toBe("data:image/png;base64,ZmFrZQ==");
    expect(roundtrip.document.note).toBe("Line one\nLine two");
    expect(roundtrip.document.uid).toBe("urn:uuid:12345678-1234-4234-9234-123456789abc");
    expect(roundtrip.document.rev).toBe("2026-03-22T10:11:12Z");
    expect(roundtrip.document.prodId).toBe("-//Example App//EN");
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
