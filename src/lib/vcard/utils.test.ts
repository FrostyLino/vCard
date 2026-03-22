import { describe, expect, it } from "vitest";
import {
  cleanList,
  decodeQuotedPrintable,
  escapeText,
  foldLine,
  hasMeaningfulValue,
  normalizeLineEndings,
  splitEscaped,
  unescapeText,
  unfoldVCardLines,
} from "./utils";

describe("vcard utils", () => {
  it("normalizes line endings and unfolds folded vCard lines", () => {
    expect(normalizeLineEndings("a\r\nb\rc")).toBe("a\nb\nc");
    expect(
      unfoldVCardLines("NOTE:Line one\r\n line two\r\n\tline three\r\nFN:Jane Doe"),
    ).toEqual(["NOTE:Line oneline twoline three", "FN:Jane Doe"]);
  });

  it("splits escaped values while respecting quotes when requested", () => {
    expect(splitEscaped(String.raw`one\,two,three`, ",")).toEqual([
      String.raw`one\,two`,
      "three",
    ]);
    expect(splitEscaped('TYPE=work;"custom,label";home', ";", { quoteAware: true })).toEqual([
      "TYPE=work",
      '"custom,label"',
      "home",
    ]);
  });

  it("escapes and unescapes text values symmetrically", () => {
    const original = "Line one\nLine;two,three\\four";

    expect(unescapeText(escapeText(original))).toBe(original);
  });

  it("folds long lines into vCard continuations", () => {
    const line = "NOTE:" + "x".repeat(90);
    const folded = foldLine(line);
    const segments = folded.split("\r\n");

    expect(segments).toHaveLength(2);
    expect(segments[0]).toHaveLength(75);
    expect(segments[1].startsWith(" ")).toBe(true);
  });

  it("decodes quoted-printable payloads for UTF-8 and latin1-compatible charsets", () => {
    expect(decodeQuotedPrintable("J=C3=B6rg=20M=C3=BCller", "utf-8")).toBe("Jörg Müller");
    expect(decodeQuotedPrintable("Andr=E9", "latin1")).toBe("André");
    expect(decodeQuotedPrintable("J=C3=B6rg=20=\nM=C3=BCller", "utf-8")).toBe("Jörg Müller");
  });

  it("detects meaningful values and cleans string lists", () => {
    expect(hasMeaningfulValue("  value  ")).toBe(true);
    expect(hasMeaningfulValue(" \n\t ")).toBe(false);
    expect(cleanList([" work ", "", " home", "   "])).toEqual(["work", "home"]);
  });
});
