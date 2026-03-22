import type { AddressValue, ValidationIssue, VCardDocument } from "./types";
import { hasMeaningfulValue } from "./utils";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const URI_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/iu;

export function validateVCardDocument(document: VCardDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!hasMeaningfulValue(document.formattedName)) {
    issues.push({
      level: "error",
      field: "formattedName",
      message: "Formatted name (FN) is required.",
    });
  }

  if (hasMeaningfulValue(document.birthday) && !isValidIsoDate(document.birthday)) {
    issues.push({
      level: "error",
      field: "birthday",
      message: "Birthday must use the YYYY-MM-DD format.",
    });
  }

  if (hasMeaningfulValue(document.anniversary) && !isValidIsoDate(document.anniversary)) {
    issues.push({
      level: "error",
      field: "anniversary",
      message: "Anniversary must use the YYYY-MM-DD format.",
    });
  }

  document.emails.forEach((entry, index) => {
    if (!hasMeaningfulValue(entry.value)) {
      issues.push({
        level: "warning",
        field: `emails.${index}.value`,
        message: `Email ${index + 1} is empty and will be skipped on save.`,
      });
      return;
    }

    if (!EMAIL_PATTERN.test(entry.value)) {
      issues.push({
        level: "error",
        field: `emails.${index}.value`,
        message: `Email ${index + 1} is not a valid email address.`,
      });
    }
  });

  document.phones.forEach((entry, index) => {
    if (!hasMeaningfulValue(entry.value)) {
      issues.push({
        level: "warning",
        field: `phones.${index}.value`,
        message: `Phone ${index + 1} is empty and will be skipped on save.`,
      });
    }
  });

  document.urls.forEach((entry, index) => {
    if (!hasMeaningfulValue(entry.value)) {
      issues.push({
        level: "warning",
        field: `urls.${index}.value`,
        message: `URL ${index + 1} is empty and will be skipped on save.`,
      });
      return;
    }

    try {
      // URL constructor is sufficient for v1 format validation.
      // eslint-disable-next-line no-new
      new URL(entry.value);
    } catch {
      issues.push({
        level: "error",
        field: `urls.${index}.value`,
        message: `URL ${index + 1} must include a valid scheme such as https://.`,
      });
    }
  });

  document.impps.forEach((entry, index) => {
    if (!hasMeaningfulValue(entry.value)) {
      issues.push({
        level: "warning",
        field: `impps.${index}.value`,
        message: `Instant messaging entry ${index + 1} is empty and will be skipped on save.`,
      });
      return;
    }

    if (!URI_SCHEME_PATTERN.test(entry.value)) {
      issues.push({
        level: "error",
        field: `impps.${index}.value`,
        message: `Instant messaging entry ${index + 1} must start with a URI scheme such as sip:, xmpp: or im:.`,
      });
    }
  });

  document.addresses.forEach((entry, index) => {
    if (!hasAddressValue(entry)) {
      issues.push({
        level: "warning",
        field: `addresses.${index}`,
        message: `Address ${index + 1} is empty and will be skipped on save.`,
      });
    }
  });

  if (
    !hasMeaningfulValue(document.name.family) &&
    !hasMeaningfulValue(document.name.given) &&
    !hasMeaningfulValue(document.formattedName)
  ) {
    issues.push({
      level: "warning",
      field: "name",
      message: "Adding structured name parts improves compatibility with other contact apps.",
    });
  }

  return issues;
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

function isValidIsoDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(value);
}
