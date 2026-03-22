interface SplitOptions {
  quoteAware?: boolean;
}

export function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

export function unfoldVCardLines(source: string): string[] {
  const normalized = normalizeLineEndings(source);
  const lines = normalized.split("\n");
  const unfolded: string[] = [];

  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
      continue;
    }

    unfolded.push(line);
  }

  return unfolded;
}

export function splitEscaped(
  value: string,
  delimiter: string,
  options: SplitOptions = {},
): string[] {
  const parts: string[] = [];
  let current = "";
  let escaped = false;
  let quoted = false;

  for (const char of value) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }

    if (options.quoteAware && char === '"') {
      current += char;
      quoted = !quoted;
      continue;
    }

    if (!quoted && char === delimiter) {
      parts.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  parts.push(current);
  return parts;
}

export function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

export function foldLine(line: string): string {
  if (line.length <= 75) {
    return line;
  }

  const segments: string[] = [];
  let remaining = line;

  while (remaining.length > 75) {
    segments.push(remaining.slice(0, 75));
    remaining = ` ${remaining.slice(75)}`;
  }

  segments.push(remaining);
  return segments.join("\r\n");
}

export function hasMeaningfulValue(value: string): boolean {
  return value.trim().length > 0;
}

export function cleanList(values: string[]): string[] {
  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}
