import { describe, expect, it } from "vitest";
import { parseVcf } from "./parser";
import { serializeVcf } from "./serializer";

describe("parseVcf", () => {
  it("parses a vCard 3.0 file and keeps grouped unknown properties", () => {
    const source = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Jane Doe",
      "N:Doe;Jane;;;",
      "item1.EMAIL;TYPE=INTERNET,WORK;TYPE=PREF:jane@example.com",
      "item1.X-ABLabel:Work",
      "NOTE:Line one\\nLine two",
      "END:VCARD",
      "",
    ].join("\r\n");

    const result = parseVcf(source);

    expect(result.document.version).toBe("3.0");
    expect(result.document.formattedName).toBe("Jane Doe");
    expect(result.document.emails).toHaveLength(1);
    expect(result.document.emails[0].group).toBe("item1");
    expect(result.document.emails[0].pref).toBe(1);
    expect(result.document.unknownProperties).toHaveLength(1);
    expect(serializeVcf(result.document)).toContain("item1.EMAIL;TYPE=PREF,INTERNET,WORK:jane@example.com");
    expect(serializeVcf(result.document)).toContain("item1.X-ABLabel:Work");
  });

  it("unfolds folded lines and roundtrips important data", () => {
    const source = [
      "BEGIN:VCARD",
      "VERSION:4.0",
      "FN:Max Mustermann",
      "N:Mustermann;Max;;;",
      "NOTE:This note was folded",
      " and continues here.",
      "TEL;TYPE=cell:+49123456789",
      "END:VCARD",
      "",
    ].join("\r\n");

    const result = parseVcf(source);
    const roundtrip = parseVcf(serializeVcf(result.document));

    expect(result.document.note).toBe("This note was foldedand continues here.");
    expect(roundtrip.document.formattedName).toBe("Max Mustermann");
    expect(roundtrip.document.phones[0].value).toBe("+49123456789");
  });

  it("rejects multiple contacts in one file", () => {
    const source = [
      "BEGIN:VCARD",
      "VERSION:4.0",
      "FN:One",
      "END:VCARD",
      "BEGIN:VCARD",
      "VERSION:4.0",
      "FN:Two",
      "END:VCARD",
      "",
    ].join("\r\n");

    expect(() => parseVcf(source)).toThrow(/exactly one/i);
  });

  it("parses embedded photo data from a vCard 4.0 file", () => {
    const source = [
      "BEGIN:VCARD",
      "VERSION:4.0",
      "FN:Photo Test",
      "PHOTO:data:image/png;base64,ZmFrZQ==",
      "END:VCARD",
      "",
    ].join("\r\n");

    const result = parseVcf(source);

    expect(result.document.photo).toEqual({
      uri: "data:image/png;base64,ZmFrZQ==",
      mediaType: "image/png",
      isEmbedded: true,
    });
    expect(serializeVcf(result.document)).toContain("PHOTO:data:image/png;base64,ZmFrZQ==");
  });

  it("converts legacy vCard 3.0 base64 photos to a portable data URI", () => {
    const source = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Legacy Photo",
      "PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQAAAQABAAD",
      "END:VCARD",
      "",
    ].join("\r\n");

    const result = parseVcf(source);
    const serialized = serializeVcf(result.document);

    expect(result.document.photo?.mediaType).toBe("image/jpeg");
    expect(result.document.photo?.isEmbedded).toBe(true);
    expect(result.document.photo?.uri).toContain("data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD");
    expect(serialized).toContain("PHOTO;VALUE=uri:data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD");
  });
});
