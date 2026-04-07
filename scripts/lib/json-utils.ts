import { readFileSync, writeFileSync } from "node:fs";

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function toFiniteNonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

export function writeJsonFile(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

export function sortObjectByKeys<T>(value: Record<string, T>): Record<string, T> {
  const sorted: Record<string, T> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = value[key];
  }
  return sorted;
}

export function bytesToMebibytesRounded(value: number): number {
  return Math.round((value / (1024 * 1024)) * 100) / 100;
}

export function getDemandPointRef(pointValue: unknown, fallbackRef: string): string {
  if (isObject(pointValue)) {
    const idValue = pointValue.id;
    if (typeof idValue === "string" && idValue.trim() !== "") {
      return idValue.trim();
    }
    if (typeof idValue === "number" && Number.isFinite(idValue)) {
      return String(idValue);
    }
  }
  return fallbackRef;
}
