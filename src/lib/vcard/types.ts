export type VCardVersion = "3.0" | "4.0";

export interface VCardParameter {
  key: string | null;
  values: string[];
}

export interface UnknownProperty {
  group?: string;
  name: string;
  params: VCardParameter[];
  value: string;
}

export interface StructuredName {
  family: string;
  given: string;
  additional: string;
  prefix: string;
  suffix: string;
}

export interface ContactValue {
  group?: string;
  value: string;
  types: string[];
  pref?: number;
  label?: string;
  extraParams: VCardParameter[];
}

export interface AddressValue {
  group?: string;
  poBox: string;
  extended: string;
  street: string;
  locality: string;
  region: string;
  postalCode: string;
  country: string;
  types: string[];
  pref?: number;
  label?: string;
  extraParams: VCardParameter[];
}

export interface PhotoValue {
  uri: string;
  mediaType?: string;
  isEmbedded: boolean;
}

export interface VCardDocument {
  version: VCardVersion;
  formattedName: string;
  name: StructuredName;
  nicknames: string[];
  organizationUnits: string[];
  title: string;
  photo: PhotoValue | null;
  emails: ContactValue[];
  phones: ContactValue[];
  urls: ContactValue[];
  addresses: AddressValue[];
  note: string;
  unknownProperties: UnknownProperty[];
}

export interface ParseResult {
  document: VCardDocument;
  warnings: string[];
}

export interface ValidationIssue {
  level: "error" | "warning";
  field: string;
  message: string;
}
