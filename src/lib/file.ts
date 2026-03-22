import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

const vcfFilter = [{ name: "vCard", extensions: ["vcf"] }];

export async function openVcf(): Promise<string | null> {
  const selected = await open({
    title: "Open vCard file",
    directory: false,
    multiple: false,
    filters: vcfFilter,
    fileAccessMode: "scoped",
  });

  if (Array.isArray(selected)) {
    return selected[0] ?? null;
  }

  return selected;
}

export async function openManyVcf(): Promise<string[]> {
  const selected = await open({
    title: "Open vCard files",
    directory: false,
    multiple: true,
    filters: vcfFilter,
    fileAccessMode: "scoped",
  });

  return Array.isArray(selected) ? selected : selected ? [selected] : [];
}

export async function openVcfFolder(): Promise<string | null> {
  const selected = await open({
    title: "Open folder with vCards",
    directory: true,
    multiple: false,
    fileAccessMode: "scoped",
  });

  return Array.isArray(selected) ? selected[0] ?? null : selected;
}

export async function chooseOutputDirectory(): Promise<string | null> {
  const selected = await open({
    title: "Choose output directory",
    directory: true,
    multiple: false,
    fileAccessMode: "scoped",
  });

  return Array.isArray(selected) ? selected[0] ?? null : selected;
}

export async function saveVcfAs(defaultPath?: string): Promise<string | null> {
  const selected = await save({
    title: "Save vCard file",
    filters: vcfFilter,
    defaultPath: ensureVcfExtension(defaultPath ?? "contact.vcf"),
  });

  return selected ? ensureVcfExtension(selected) : null;
}

export async function listVcfFilesInDirectory(path: string): Promise<string[]> {
  return invoke<string[]>("list_vcf_files_in_directory", { path });
}

export async function readVcfFile(path: string): Promise<string> {
  return invoke<string>("read_vcf_file", { path });
}

export async function writeVcfFile(path: string, content: string): Promise<void> {
  await invoke("write_vcf_file", { path, content });
}

export function ensureVcfExtension(path: string): string {
  return path.toLowerCase().endsWith(".vcf") ? path : `${path}.vcf`;
}

export function getPathLabel(path: string | null): string {
  if (!path) {
    return "Unsaved draft";
  }

  const segments = path.split(/[\\/]/u).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}
