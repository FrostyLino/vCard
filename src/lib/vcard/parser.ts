import {
  createEmptyAddressValue,
  createEmptyContactValue,
  createEmptyDocument,
  createEmptyStructuredName,
} from "./document";
import type {
  AddressValue,
  ContactValue,
  ParseResult,
  PhotoValue,
  VCardDocument,
  VCardParameter,
  VCardVersion,
} from "./types";
import { cleanList, hasMeaningfulValue, splitEscaped, unescapeText, unfoldVCardLines } from "./utils";

interface ParsedLine {
  group?: string;
  rawName: string;
  name: string;
  params: VCardParameter[];
  value: string;
}

export function parseVcf(source: string): ParseResult {
  const parsedLines = unfoldVCardLines(source)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .map(parseLine);

  const beginIndexes = parsedLines
    .map((line, index) =>
      line.name === "BEGIN" && line.value.toUpperCase() === "VCARD" ? index : -1,
    )
    .filter((index) => index >= 0);
  const endIndexes = parsedLines
    .map((line, index) =>
      line.name === "END" && line.value.toUpperCase() === "VCARD" ? index : -1,
    )
    .filter((index) => index >= 0);

  if (beginIndexes.length !== 1 || endIndexes.length !== 1) {
    throw new Error("The file must contain exactly one BEGIN:VCARD and one END:VCARD block.");
  }

  const beginIndex = beginIndexes[0];
  const endIndex = endIndexes[0];

  if (beginIndex >= endIndex) {
    throw new Error("The BEGIN:VCARD and END:VCARD markers are in an invalid order.");
  }

  if (parsedLines.slice(beginIndex + 1, endIndex).some((line) => line.name === "BEGIN")) {
    throw new Error("Multiple vCard entries in a single file are not supported in v1.");
  }

  const bodyLines = parsedLines.slice(beginIndex + 1, endIndex);
  const versionLine = bodyLines.find((line) => line.name === "VERSION");

  if (!versionLine) {
    throw new Error("The vCard is missing a VERSION property.");
  }

  const version = normalizeVersion(versionLine.value);
  const document = createEmptyDocument(version);
  const warnings: string[] = [];

  for (const line of bodyLines) {
    if (line.name === "VERSION") {
      continue;
    }

    if (line.name === "PHOTO") {
      const parsedPhoto = parsePhotoValue(line);

      if (parsedPhoto) {
        if (document.photo) {
          warnings.push("Multiple PHOTO properties found. The last one was used.");
        }

        document.photo = parsedPhoto;
      } else {
        document.unknownProperties.push(toUnknownProperty(line));
        warnings.push("A PHOTO property could not be interpreted and was preserved as raw data.");
      }
      continue;
    }

    if (hasUnsupportedEncoding(line)) {
      document.unknownProperties.push(toUnknownProperty(line));
      warnings.push(`${line.name} uses unsupported encoding parameters and was preserved as raw data.`);
      continue;
    }

    switch (line.name) {
      case "FN": {
        if (hasMeaningfulValue(document.formattedName)) {
          warnings.push("Multiple FN properties found. The last one was used.");
        }

        document.formattedName = unescapeText(line.value);
        break;
      }
      case "N": {
        if (Object.values(document.name).some(hasMeaningfulValue)) {
          warnings.push("Multiple N properties found. The last one was used.");
        }

        document.name = parseStructuredName(line.value);
        break;
      }
      case "NICKNAME": {
        document.nicknames = [
          ...document.nicknames,
          ...splitEscaped(line.value, ",").map(unescapeText).filter(hasMeaningfulValue),
        ];
        break;
      }
      case "ORG": {
        if (document.organizationUnits.length > 0) {
          warnings.push("Multiple ORG properties found. The last one was used.");
        }

        document.organizationUnits = splitEscaped(line.value, ";")
          .map(unescapeText)
          .filter(hasMeaningfulValue);
        break;
      }
      case "TITLE": {
        if (hasMeaningfulValue(document.title)) {
          warnings.push("Multiple TITLE properties found. The last one was used.");
        }

        document.title = unescapeText(line.value);
        break;
      }
      case "NOTE": {
        if (hasMeaningfulValue(document.note)) {
          warnings.push("Multiple NOTE properties found. The last one was used.");
        }

        document.note = unescapeText(line.value);
        break;
      }
      case "EMAIL": {
        document.emails.push(parseContactValue(line));
        break;
      }
      case "TEL": {
        document.phones.push(parseContactValue(line));
        break;
      }
      case "URL": {
        document.urls.push(parseContactValue(line));
        break;
      }
      case "ADR": {
        document.addresses.push(parseAddressValue(line));
        break;
      }
      default: {
        document.unknownProperties.push(toUnknownProperty(line));
      }
    }
  }

  return { document, warnings };
}

function parseLine(line: string): ParsedLine {
  const separatorIndex = findValueSeparator(line);

  if (separatorIndex < 0) {
    throw new Error(`Invalid content line: ${line}`);
  }

  const head = line.slice(0, separatorIndex);
  const value = line.slice(separatorIndex + 1);
  const headSegments = splitEscaped(head, ";", { quoteAware: true });
  const rawName = headSegments[0];
  const dotIndex = rawName.lastIndexOf(".");
  const group = dotIndex >= 0 ? rawName.slice(0, dotIndex) : undefined;
  const propertyName = dotIndex >= 0 ? rawName.slice(dotIndex + 1) : rawName;
  const name = propertyName.toUpperCase();

  return {
    group,
    rawName: propertyName,
    name,
    params: headSegments.slice(1).map(parseParameter).filter((value): value is VCardParameter => value !== null),
    value,
  };
}

function findValueSeparator(line: string): number {
  let escaped = false;
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (!quoted && char === ":") {
      return index;
    }
  }

  return -1;
}

function parseParameter(source: string): VCardParameter | null {
  if (!hasMeaningfulValue(source)) {
    return null;
  }

  const separatorIndex = source.indexOf("=");
  if (separatorIndex < 0) {
    return {
      key: "TYPE",
      values: splitEscaped(source, ",", { quoteAware: true }).map(normalizeParameterValue),
    };
  }

  const key = source.slice(0, separatorIndex).trim().toUpperCase();
  const rawValues = splitEscaped(source.slice(separatorIndex + 1), ",", { quoteAware: true });

  return {
    key,
    values: rawValues.map(normalizeParameterValue),
  };
}

function normalizeParameterValue(value: string): string {
  const trimmed = value.trim();

  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) {
    return trimmed;
  }

  return trimmed.slice(1, -1).replace(/\\"/g, '"');
}

function normalizeVersion(value: string): VCardVersion {
  const trimmed = value.trim();

  if (trimmed === "3.0" || trimmed === "4.0") {
    return trimmed;
  }

  throw new Error(`Unsupported vCard version: ${value}`);
}

function parseStructuredName(value: string) {
  const [family = "", given = "", additional = "", prefix = "", suffix = ""] = splitEscaped(
    value,
    ";",
  ).map(unescapeText);

  return {
    ...createEmptyStructuredName(),
    family,
    given,
    additional,
    prefix,
    suffix,
  };
}

function parseContactValue(line: ParsedLine): ContactValue {
  const { types, pref, label, extraParams } = extractEntryMetadata(line.params);
  return {
    ...createEmptyContactValue(),
    group: line.group,
    value: unescapeText(line.value),
    types,
    pref,
    label,
    extraParams,
  };
}

function parseAddressValue(line: ParsedLine): AddressValue {
  const [poBox = "", extended = "", street = "", locality = "", region = "", postalCode = "", country = ""] =
    splitEscaped(line.value, ";").map(unescapeText);
  const { types, pref, label, extraParams } = extractEntryMetadata(line.params);

  return {
    ...createEmptyAddressValue(),
    group: line.group,
    poBox,
    extended,
    street,
    locality,
    region,
    postalCode,
    country,
    types,
    pref,
    label,
    extraParams,
  };
}

function parsePhotoValue(line: ParsedLine): PhotoValue | null {
  const value = line.value.trim();
  const encoding = findParameterValues(line.params, "ENCODING")[0]?.toLowerCase();
  const mediaType = extractPhotoMediaType(line.params);

  if (encoding === "b" || encoding === "base64") {
    const base64 = value.replace(/\s+/g, "");
    if (!base64) {
      return null;
    }

    const normalizedMediaType = mediaType ?? "image/jpeg";
    return {
      uri: `data:${normalizedMediaType};base64,${base64}`,
      mediaType: normalizedMediaType,
      isEmbedded: true,
    };
  }

  if (!value) {
    return null;
  }

  if (value.startsWith("data:")) {
    return {
      uri: value,
      mediaType: extractMediaTypeFromDataUri(value) ?? mediaType,
      isEmbedded: true,
    };
  }

  return {
    uri: value,
    mediaType,
    isEmbedded: false,
  };
}

function extractEntryMetadata(params: VCardParameter[]) {
  const types: string[] = [];
  const extraParams: VCardParameter[] = [];
  let pref: number | undefined;
  let label: string | undefined;

  for (const param of params) {
    const key = param.key?.toUpperCase() ?? "TYPE";
    const normalizedValues = cleanList(param.values.map((value) => value.toLowerCase()));

    if (key === "TYPE") {
      types.push(...normalizedValues);
      continue;
    }

    if (key === "PREF") {
      const parsed = Number.parseInt(param.values[0] ?? "", 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        pref = parsed;
        continue;
      }
    }

    if (key === "LABEL") {
      label = param.values.join(",");
      continue;
    }

    extraParams.push({
      key,
      values: [...param.values],
    });
  }

  const uniqueTypes = Array.from(new Set(types));
  const prefIndex = uniqueTypes.indexOf("pref");
  if (prefIndex >= 0) {
    uniqueTypes.splice(prefIndex, 1);
    pref ??= 1;
  }

  return {
    types: uniqueTypes,
    pref,
    label,
    extraParams,
  };
}

function extractPhotoMediaType(params: VCardParameter[]): string | undefined {
  const mediaType = findParameterValues(params, "MEDIATYPE")[0];
  if (mediaType) {
    return mediaType.toLowerCase();
  }

  for (const rawType of findParameterValues(params, "TYPE")) {
    const normalized = rawType.toLowerCase();
    const mapped = PHOTO_TYPE_MAP[normalized];
    if (mapped) {
      return mapped;
    }

    if (normalized.startsWith("image/")) {
      return normalized;
    }
  }

  return undefined;
}

function extractMediaTypeFromDataUri(value: string): string | undefined {
  const match = /^data:([^;,]+)[;,]/iu.exec(value);
  return match?.[1]?.toLowerCase();
}

function findParameterValues(params: VCardParameter[], key: string): string[] {
  return params
    .filter((param) => (param.key?.toUpperCase() ?? "TYPE") === key)
    .flatMap((param) => param.values.map((value) => value.trim()));
}

function hasUnsupportedEncoding(line: ParsedLine): boolean {
  return line.params.some((param) => {
    const key = param.key?.toUpperCase();
    return key === "ENCODING" || key === "CHARSET";
  });
}

function toUnknownProperty(line: ParsedLine) {
  return {
    group: line.group,
    name: line.rawName,
    params: line.params.map((param) => ({
      key: param.key,
      values: [...param.values],
    })),
    value: line.value,
  };
}

export function createDocumentFromVersion(version: VCardVersion): VCardDocument {
  return createEmptyDocument(version);
}

const PHOTO_TYPE_MAP: Record<string, string> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  heic: "image/heic",
  heif: "image/heif",
};
