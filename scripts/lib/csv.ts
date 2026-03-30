import { writeFileSync } from "node:fs";

export function escapeCsv(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

export function writeCsv<T extends object>(
  path: string,
  headers: readonly string[],
  rows: readonly T[],
): void {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsv(row[header as keyof T] ?? "")).join(","));
  }
  writeFileSync(path, `${lines.join("\n")}\n`, "utf-8");
}
