import type {
  AddressValue,
  ContactValue,
  StructuredName,
  VCardDocument,
  VCardVersion,
} from "./types";

export const DEFAULT_PRODID = "-//vCard Editor//EN";

export function createEmptyStructuredName(): StructuredName {
  return {
    family: "",
    given: "",
    additional: "",
    prefix: "",
    suffix: "",
  };
}

export function createEmptyContactValue(): ContactValue {
  return {
    value: "",
    types: [],
    extraParams: [],
  };
}

export function createEmptyAddressValue(): AddressValue {
  return {
    poBox: "",
    extended: "",
    street: "",
    locality: "",
    region: "",
    postalCode: "",
    country: "",
    types: [],
    extraParams: [],
  };
}

export function createEmptyDocument(version: VCardVersion = "4.0"): VCardDocument {
  return {
    version,
    formattedName: "",
    name: createEmptyStructuredName(),
    nicknames: [],
    organizationUnits: [],
    title: "",
    role: "",
    birthday: "",
    anniversary: "",
    photo: null,
    emails: [],
    phones: [],
    urls: [],
    impps: [],
    addresses: [],
    note: "",
    uid: "",
    rev: "",
    prodId: "",
    unknownProperties: [],
  };
}

export function ensureManagedMetadata(document: VCardDocument): VCardDocument {
  return {
    ...document,
    uid: document.uid || createUidValue(),
    prodId: document.prodId || DEFAULT_PRODID,
  };
}

export function touchManagedMetadata(document: VCardDocument, now = new Date()): VCardDocument {
  const ensured = ensureManagedMetadata(document);

  return {
    ...ensured,
    uid: ensured.uid,
    rev: createRevisionValue(now),
    prodId: ensured.prodId,
  };
}

export function createUidValue(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `urn:uuid:${crypto.randomUUID()}`;
  }

  return `urn:uuid:${fallbackUuid()}`;
}

export function createRevisionValue(now = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/u, "Z");
}

function fallbackUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/gu, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
