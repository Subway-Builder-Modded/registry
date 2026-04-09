import { ListingManifestSchema } from "@subway-builder-modded/registry-schemas";

export function assertValidRegistryManifest(
  manifest: unknown,
  label: string,
): void {
  const result = ListingManifestSchema.safeParse(manifest);
  if (result.success) return;
  const details = result.error.issues
    .map((issue) => `${issue.path.join(".") || "/"} ${issue.message}`)
    .join("; ");
  throw new Error(`${label} failed schema validation: ${details}`);
}
