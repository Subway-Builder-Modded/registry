import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalizeJsonText,
  decodeStrictUtf8,
  findMojibake,
  fixMojibake,
  hasUtf8Bom,
} from "../lib/formatting.js";

// --- mojibake ---

test("repairs the CP-1252 round-trip for common punctuation", () => {
  assert.equal(fixMojibake("results here â€” usually fast").text, "results here — usually fast");
  assert.equal(fixMojibake("donâ€™t").text, "don’t");
  assert.equal(fixMojibake("â€œquotedâ€").text, "“quoted”");
});

test("repairs two-byte accented-latin mojibake", () => {
  assert.equal(fixMojibake("cafÃ©").text, "café");
  assert.equal(fixMojibake("SÃ£o Paulo").text, "São Paulo");
});

test("repairs four-byte (emoji) mojibake", () => {
  assert.equal(fixMojibake("ðŸ˜€").text, "😀");
});

test("unwinds double-encoded mojibake", () => {
  // — encoded twice: â€” re-corrupted through a second CP-1252 round trip.
  const doubled = fixMojibake("Ã¢â‚¬â€");
  assert.equal(doubled.text, "—");
});

test("leaves legitimate Czech place names untouched, but repairs mojibake'd Czech", () => {
  // Úž / Úš reverse-decode to byte-valid Arabic letters — the plausibility
  // guard must reject that repair (real case: maps/yukina-cz-praha).
  assert.deepEqual(findMojibake("Úžice a Úštěk"), []);
  // ...while genuinely mojibake'd Czech (ž -> Å¾) is still repaired.
  assert.equal(fixMojibake("Å½elezniÄnÃ­").text.startsWith("Železni"), true);
});

test("leaves legitimate text untouched", () => {
  for (const text of [
    "SÃO PAULO",            // uppercase Portuguese: Ã followed by ASCII
    "café — naïve résumé",  // genuine accents and em dash
    "a Â£10 note? no: £10", // £ alone is fine; Â£ would be mojibake
    "plain ascii text",
  ]) {
    const findings = findMojibake(text);
    if (text.includes("Â£")) {
      // the Â£ half is mojibake and should be found; the bare £ half is not
      assert.equal(findings.length, 1);
    } else {
      assert.deepEqual(findings, [], `unexpected findings in: ${text}`);
    }
  }
});

test("reports sequence positions and replacements", () => {
  const findings = findMojibake("x â€” y Ã© z");
  assert.equal(findings.length, 2);
  assert.deepEqual(findings.map((f) => f.replacement), ["—", "é"]);
});

// --- BOM / UTF-8 ---

test("detects a UTF-8 BOM", () => {
  assert.equal(hasUtf8Bom(Buffer.from([0xef, 0xbb, 0xbf, 0x7b])), true);
  assert.equal(hasUtf8Bom(Buffer.from('{"a":1}')), false);
});

test("rejects invalid UTF-8", () => {
  assert.equal(decodeStrictUtf8(Buffer.from([0x61, 0xe9, 0x62])), null); // raw CP-1252 é
  assert.equal(decodeStrictUtf8(Buffer.from("valid é")), "valid é");
});

// --- JSON canonicalization ---

test("canonical form matches every repo writer and is idempotent", () => {
  const raw = '{\n  "b": [1, 2],\n  "a": {}\n}\n';
  const canonical = canonicalizeJsonText(raw)!;
  assert.equal(canonical, '{\n  "b": [\n    1,\n    2\n  ],\n  "a": {}\n}\n');
  assert.equal(canonicalizeJsonText(canonical), canonical);
});

test("preserves key order and JS number formatting", () => {
  const canonical = canonicalizeJsonText('{"z": 1, "a": 9.929497353721012e-8}')!;
  assert.ok(canonical.indexOf('"z"') < canonical.indexOf('"a"'));
  assert.ok(canonical.includes("9.929497353721012e-8"));
});

test("returns null for unparseable JSON", () => {
  assert.equal(canonicalizeJsonText("{not json"), null);
});
