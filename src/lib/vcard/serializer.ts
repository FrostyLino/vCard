import type {
  AddressValue,
  ContactValue,
  PhotoValue,
  UnknownProperty,
  VCardDocument,
  VCardParameter,
} from "./types";
import { cleanList, escapeText, foldLine, hasMeaningfulValue } from "./utils";

export function serializeVcf(document: VCardDocument): string {
  const lines: string[] = [
    "BEGIN:VCARD",
    `VERSION:${document.version}`,
    serializeProperty("FN", escapeText(document.formattedName)),
  ];

  if (hasStructuredName(document)) {
    lines.push(
      serializeProperty(
        "N",
        [
          document.name.family,
          document.name.given,
          document.name.additional,
          document.name.prefix,
          document.name.suffix,
        ]
          .map(escapeText)
          .join(";"),
      ),
    );
  }

  if (document.nicknames.length > 0) {
    lines.push(
      serializeProperty(
        "NICKNAME",
        cleanList(document.nicknames).map(escapeText).join(","),
      ),
    );
  }

  if (document.organizationUnits.length > 0) {
    lines.push(
      serializeProperty(
        "ORG",
        cleanList(document.organizationUnits).map(escapeText).join(";"),
      ),
    );
  }

  if (hasMeaningfulValue(document.title)) {
    lines.push(serializeProperty("TITLE", escapeText(document.title)));
  }

  if (document.photo?.uri) {
    lines.push(serializePhotoProperty(document.photo, document.version));
  }

  for (const email of document.emails.filter((value) => hasMeaningfulValue(value.value))) {
    lines.push(...serializeContactProperties("EMAIL", email, document.version));
  }

  for (const phone of document.phones.filter((value) => hasMeaningfulValue(value.value))) {
    lines.push(...serializeContactProperties("TEL", phone, document.version));
  }

  for (const url of document.urls.filter((value) => hasMeaningfulValue(value.value))) {
    lines.push(...serializeContactProperties("URL", url, document.version));
  }

  for (const address of document.addresses.filter(hasAddressValue)) {
    lines.push(...serializeAddressProperties(address, document.version));
  }

  if (hasMeaningfulValue(document.note)) {
    lines.push(serializeProperty("NOTE", escapeText(document.note)));
  }

  for (const property of document.unknownProperties) {
    lines.push(serializeUnknownProperty(property));
  }

  lines.push("END:VCARD");
  return `${lines.join("\r\n")}\r\n`;
}

function hasStructuredName(document: VCardDocument): boolean {
  return Object.values(document.name).some(hasMeaningfulValue);
}

function hasAddressValue(address: AddressValue): boolean {
  return [
    address.poBox,
    address.extended,
    address.street,
    address.locality,
    address.region,
    address.postalCode,
    address.country,
  ].some(hasMeaningfulValue);
}

function serializeContactProperties(
  name: string,
  value: ContactValue,
  version: VCardDocument["version"],
): string[] {
  const useAppleGroupedLabel = shouldUseAppleGroupedLabel(value);
  const params = buildEntryParameters(
    {
      ...value,
      label: useAppleGroupedLabel ? undefined : value.label,
    },
    version,
  );
  const lines = [serializeProperty(name, escapeText(value.value), params, value.group)];

  if (useAppleGroupedLabel) {
    lines.push(serializeProperty("X-ABLabel", escapeText(value.label ?? ""), [], value.group));
  }

  return lines;
}

function serializeAddressProperties(
  value: AddressValue,
  version: VCardDocument["version"],
): string[] {
  const useAppleGroupedLabel = shouldUseAppleGroupedLabel(value);
  const params = buildEntryParameters(
    {
      ...value,
      label: useAppleGroupedLabel ? undefined : value.label,
    },
    version,
  );
  const addressValue = [
    value.poBox,
    value.extended,
    value.street,
    value.locality,
    value.region,
    value.postalCode,
    value.country,
  ]
    .map(escapeText)
    .join(";");

  const lines = [serializeProperty("ADR", addressValue, params, value.group)];

  if (useAppleGroupedLabel) {
    lines.push(serializeProperty("X-ABLabel", escapeText(value.label ?? ""), [], value.group));
  }

  return lines;
}

function serializePhotoProperty(value: PhotoValue, version: VCardDocument["version"]) {
  const params: VCardParameter[] = [];

  if (version === "3.0") {
    params.push({
      key: "VALUE",
      values: ["uri"],
    });
  }

  if (version === "4.0" && value.mediaType && !value.uri.startsWith("data:")) {
    params.push({
      key: "MEDIATYPE",
      values: [value.mediaType],
    });
  }

  return serializeProperty("PHOTO", value.uri, params);
}

function buildEntryParameters(
  value: Pick<ContactValue, "types" | "pref" | "label" | "extraParams">,
  version: VCardDocument["version"],
): VCardParameter[] {
  const params: VCardParameter[] = [];
  const types = cleanList(value.types.map((type) => type.toUpperCase()));

  if (value.pref && version === "3.0") {
    types.unshift("PREF");
  }

  if (types.length > 0) {
    params.push({
      key: "TYPE",
      values: Array.from(new Set(types)),
    });
  }

  if (value.pref && version === "4.0") {
    params.push({
      key: "PREF",
      values: [String(value.pref)],
    });
  }

  if (hasMeaningfulValue(value.label ?? "")) {
    params.push({
      key: "LABEL",
      values: [value.label ?? ""],
    });
  }

  for (const param of value.extraParams) {
    params.push({
      key: param.key,
      values: [...param.values],
    });
  }

  return params;
}

function shouldUseAppleGroupedLabel(value: Pick<ContactValue, "group" | "label">): boolean {
  return Boolean(value.group && hasMeaningfulValue(value.label ?? ""));
}

function serializeUnknownProperty(property: UnknownProperty): string {
  return serializeProperty(property.name, property.value, property.params, property.group, false);
}

function serializeProperty(
  name: string,
  value: string,
  params: VCardParameter[] = [],
  group?: string,
  fold = true,
): string {
  const prefix = group ? `${group}.${name}` : name;
  const head = params.reduce((result, param) => `${result};${serializeParameter(param)}`, prefix);
  const line = `${head}:${value}`;

  return fold ? foldLine(line) : line;
}

function serializeParameter(param: VCardParameter): string {
  const rawValues = param.values.map(quoteParameterValue).join(",");

  if (!param.key || param.key === "TYPE") {
    return `TYPE=${rawValues}`;
  }

  return `${param.key}=${rawValues}`;
}

function quoteParameterValue(value: string): string {
  if (/^[a-zA-Z0-9._-]+$/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}
