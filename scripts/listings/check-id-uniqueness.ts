import { resolve } from "node:path";
import { findCrossTypeIdCollisions } from "../lib/registry-uniqueness.js";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");

const collisions = findCrossTypeIdCollisions(REPO_ROOT);
if (collisions.length > 0) {
  console.error(
    `Listing IDs must be unique across maps and mods; found in both: ${collisions.join(", ")}`,
  );
  process.exit(1);
}
console.log("All listing IDs are unique across maps and mods.");
