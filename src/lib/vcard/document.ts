import type {
  AddressValue,
  ContactValue,
  StructuredName,
  VCardDocument,
  VCardVersion,
} from "./types";

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
    photo: null,
    emails: [],
    phones: [],
    urls: [],
    addresses: [],
    note: "",
    unknownProperties: [],
  };
}
