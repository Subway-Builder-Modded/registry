export async function validateCustomUpdateUrl(url: string): Promise<string[]> {
  const errors: string[] = [];

  // 1. Fetch the URL
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (err) {
    errors.push(`**custom-update-url**: Could not reach \`${url}\` (${(err as Error).message}).`);
    return errors;
  }

  if (!res.ok) {
    errors.push(`**custom-update-url**: \`${url}\` returned HTTP ${res.status}.`);
    return errors;
  }

  // 2. Parse as JSON
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    errors.push(`**custom-update-url**: \`${url}\` did not return valid JSON.`);
    return errors;
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    errors.push(`**custom-update-url**: \`${url}\` must return a JSON object.`);
    return errors;
  }

  const data = body as Record<string, unknown>;

  // 3. Check schema_version
  if (data.schema_version !== 1) {
    errors.push(`**custom-update-url**: \`schema_version\` must be \`1\`.`);
  }

  // 4. Check versions array
  if (!Array.isArray(data.versions)) {
    errors.push(`**custom-update-url**: \`versions\` must be an array.`);
    return errors;
  }

  if (data.versions.length === 0) {
    errors.push(`**custom-update-url**: \`versions\` array is empty. Add at least one version entry.`);
    return errors;
  }

  // 5. Validate first version entry has required fields
  const required = ["version", "game_version", "date", "download", "sha256"] as const;
  const first = data.versions[0] as Record<string, unknown>;
  for (const field of required) {
    if (typeof first[field] !== "string" || first[field] === "") {
      errors.push(`**custom-update-url**: First version entry is missing required field \`${field}\`.`);
    }
  }

  return errors;
}
