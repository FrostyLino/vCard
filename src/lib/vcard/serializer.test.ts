import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "./document";
import { serializeVcf } from "./serializer";
import { unfoldVCardLines } from "./utils";

describe("serializeVcf", () => {
  it("serializes a minimal 4.0 vCard with the required wrapper fields", () => {
    const document = createEmptyDocument("4.0");
    document.formattedName = "Jane Doe";

    expect(serializeVcf(document)).toBe(
      ["BEGIN:VCARD", "VERSION:4.0", "FN:Jane Doe", "END:VCARD", ""].join("\r\n"),
    );
  });

  it("serializes contact metadata, labels, extra params and groups deterministically", () => {
    const document = createEmptyDocument("4.0");
    document.formattedName = "Jane Doe";
    document.emails.push({
      group: "item1",
      value: "jane@example.com",
      types: ["work", "home", "work"],
      pref: 2,
      label: 'Main "VIP" line',
      extraParams: [{ key: "X-ABLABEL", values: ["Office"] }],
    });

    const serialized = unfoldVCardLines(serializeVcf(document)).join("\n");

    expect(serialized).toContain(
      'item1.EMAIL;TYPE=WORK,HOME;PREF=2;X-ABLABEL=Office:jane@example.com',
    );
    expect(serialized).toContain('item1.X-ABLabel:Main "VIP" line');
  });

  it("uses vCard-3.0 conventions for pref flags and photo URIs", () => {
    const document = createEmptyDocument("3.0");
    document.formattedName = "Legacy Contact";
    document.photo = {
      uri: "https://example.com/photo.jpg",
      mediaType: "image/jpeg",
      isEmbedded: false,
    };
    document.phones.push({
      value: "+49 151 1234567",
      types: ["cell"],
      pref: 1,
      extraParams: [],
    });

    const serialized = serializeVcf(document);

    expect(serialized).toContain("PHOTO;VALUE=uri:https://example.com/photo.jpg");
    expect(serialized).toContain("TEL;TYPE=PREF,CELL:+49 151 1234567");
  });

  it("skips empty optional rows, folds long values and preserves unknown properties", () => {
    const document = createEmptyDocument("4.0");
    document.formattedName = "Jane Doe";
    document.note = "A".repeat(120);
    document.emails.push({
      value: "   ",
      types: ["work"],
      extraParams: [],
    });
    document.addresses.push({
      poBox: "",
      extended: "",
      street: "",
      locality: "",
      region: "",
      postalCode: "",
      country: "",
      types: ["home"],
      extraParams: [],
    });
    document.unknownProperties.push({
      group: "item1",
      name: "X-CUSTOM",
      params: [{ key: "TYPE", values: ["demo"] }],
      value: "kept",
    });

    const serialized = serializeVcf(document);

    expect(serialized).not.toContain("EMAIL:");
    expect(serialized).not.toContain("ADR:");
    expect(serialized).toContain("NOTE:");
    expect(serialized).toContain("\r\n ");
    expect(serialized).toContain("item1.X-CUSTOM;TYPE=demo:kept");
  });

  it("adds MEDIATYPE for non-embedded photos in vCard 4.0", () => {
    const document = createEmptyDocument("4.0");
    document.formattedName = "Jane Doe";
    document.photo = {
      uri: "https://example.com/photo.png",
      mediaType: "image/png",
      isEmbedded: false,
    };

    expect(serializeVcf(document)).toContain(
      'PHOTO;MEDIATYPE="image/png":https://example.com/photo.png',
    );
  });
});
