import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "./document";
import { parseVcf } from "./parser";
import { serializeVcf } from "./serializer";

describe("parseVcf", () => {
  it("maps Apple grouped labels onto entries and serializes them back compatibly", () => {
    const source = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Jane Doe",
      "N:Doe;Jane;;;",
      "item1.EMAIL;TYPE=INTERNET,WORK;TYPE=PREF:jane@example.com",
      "item1.X-ABLabel:Work",
      "item2.ADR;TYPE=HOME:;;Street 1;Berlin;;;Germany",
      "item2.X-ABLabel:Home Base",
      "NOTE:Line one\\nLine two",
      "END:VCARD",
      "",
    ].join("\r\n");

    const result = parseVcf(source);
    const serialized = serializeVcf(result.document);

    expect(result.document.version).toBe("3.0");
    expect(result.document.formattedName).toBe("Jane Doe");
    expect(result.document.emails).toHaveLength(1);
    expect(result.document.emails[0].group).toBe("item1");
    expect(result.document.emails[0].pref).toBe(1);
    expect(result.document.emails[0].label).toBe("Work");
    expect(result.document.addresses[0].group).toBe("item2");
    expect(result.document.addresses[0].label).toBe("Home Base");
    expect(result.document.unknownProperties).toHaveLength(0);
    expect(serialized).toContain("item1.EMAIL;TYPE=PREF,INTERNET,WORK:jane@example.com");
    expect(serialized).toContain("item1.X-ABLabel:Work");
    expect(serialized).toContain("item2.ADR;TYPE=HOME:;;Street 1;Berlin;;;Germany");
    expect(serialized).toContain("item2.X-ABLabel:Home Base");
    expect(serialized).not.toContain("LABEL=");
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

  it("detects the photo media type even when TYPE contains multiple values", () => {
    const source = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:PNG Photo",
      "PHOTO;ENCODING=b;TYPE=BASE64,PNG:iVBORw0KGgoAAAANSUhEUgAAAAUA",
      "END:VCARD",
      "",
    ].join("\r\n");

    const result = parseVcf(source);

    expect(result.document.photo?.mediaType).toBe("image/png");
    expect(result.document.photo?.uri).toContain("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA");
  });

  it("roundtrips quoted label parameters without keeping escape slashes", () => {
    const document = createEmptyDocument("4.0");
    document.formattedName = "Jane Doe";
    document.emails.push({
      value: "jane@example.com",
      types: ["work"],
      label: 'Main "VIP" line',
      extraParams: [],
    });

    const parsed = parseVcf(serializeVcf(document));

    expect(parsed.document.emails[0].label).toBe('Main "VIP" line');
  });

  it("accepts UTF-8 charset parameters on known text fields", () => {
    const source = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN;CHARSET=UTF-8:Jöhn Döe",
      "N;CHARSET=UTF-8:Döe;Jöhn;;;",
      "NOTE;CHARSET=UTF-8:Grüße aus München",
      "END:VCARD",
      "",
    ].join("\r\n");

    const result = parseVcf(source);

    expect(result.warnings).toHaveLength(0);
    expect(result.document.formattedName).toBe("Jöhn Döe");
    expect(result.document.name.family).toBe("Döe");
    expect(result.document.name.given).toBe("Jöhn");
    expect(result.document.note).toBe("Grüße aus München");
  });

  it("decodes quoted-printable text fields with UTF-8 payloads", () => {
    const source = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:J=C3=B6rg M=C3=BCller",
      "NOTE;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Gr=C3=BC=C3=9Fe aus K=C3=B6ln",
      "END:VCARD",
      "",
    ].join("\r\n");

    const result = parseVcf(source);

    expect(result.warnings).toHaveLength(0);
    expect(result.document.formattedName).toBe("Jörg Müller");
    expect(result.document.note).toBe("Grüße aus Köln");
  });

  it("decodes folded quoted-printable text fields across continued lines", () => {
    const source = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:J=C3=B6rg=20=",
      " M=C3=BCller",
      "END:VCARD",
      "",
    ].join("\r\n");

    const result = parseVcf(source);

    expect(result.warnings).toHaveLength(0);
    expect(result.document.formattedName).toBe("Jörg Müller");
  });

  it("decodes quoted-printable text fields with ISO-8859-1 payloads", () => {
    const source = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN;CHARSET=ISO-8859-1;ENCODING=QUOTED-PRINTABLE:Andr=E9 M=FCller",
      "END:VCARD",
      "",
    ].join("\r\n");

    const result = parseVcf(source);

    expect(result.warnings).toHaveLength(0);
    expect(result.document.formattedName).toBe("André Müller");
  });

  it("parses business-card fields and managed metadata explicitly", () => {
    const source = [
      "BEGIN:VCARD",
      "VERSION:4.0",
      "PRODID:-//Example App//EN",
      "FN:Jane Doe",
      "ROLE:Primary client contact",
      "BDAY:1988-04-12",
      "ANNIVERSARY:2018-09-01",
      "IMPP;TYPE=WORK;PREF=1:sip:jane@example.com",
      "UID:urn:uuid:12345678-1234-4234-9234-123456789abc",
      "REV:2026-03-22T10:11:12Z",
      "END:VCARD",
      "",
    ].join("\r\n");

    const result = parseVcf(source);

    expect(result.document.role).toBe("Primary client contact");
    expect(result.document.birthday).toBe("1988-04-12");
    expect(result.document.anniversary).toBe("2018-09-01");
    expect(result.document.impps[0]).toMatchObject({
      value: "sip:jane@example.com",
      types: ["work"],
      pref: 1,
    });
    expect(result.document.uid).toBe("urn:uuid:12345678-1234-4234-9234-123456789abc");
    expect(result.document.rev).toBe("2026-03-22T10:11:12Z");
    expect(result.document.prodId).toBe("-//Example App//EN");
  });
});
