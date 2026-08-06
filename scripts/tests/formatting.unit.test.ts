import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalizeJsonText,
  decodeStrictUtf8,
  findMojibake,
  fixMojibake,
  hasUtf8Bom,
} from "../lib/formatting.js";

// Mojibake fixtures are written as \u escapes so this file itself stays
// ASCII-clean under the formatting check (raw fixtures would self-flag, and
// the auto-fixer would "repair" the tests into asserting nothing).
const MOJI_EM_DASH = "\u00e2\u20ac\u201d"; // em dash through a CP-1252 round trip
const MOJI_RSQUO = "\u00e2\u20ac\u2122"; // right single quote
const MOJI_LDQUO = "\u00e2\u20ac\u0153"; // left double quote
const MOJI_RDQUO = "\u00e2\u20ac\u009d"; // right double quote
const MOJI_E_ACUTE = "\u00c3\u00a9"; // e-acute
const MOJI_A_TILDE = "\u00c3\u00a3"; // a-tilde
const MOJI_POUND = "\u00c2\u00a3"; // pound sign
const MOJI_EMOJI = "\u00f0\u0178\u02dc\u20ac"; // grinning-face emoji
const MOJI_Z_CARON_UC = "\u00c5\u00bd"; // Z-caron
const MOJI_Z_CARON = "\u00c5\u00be"; // z-caron
const MOJI_EM_DASH_DOUBLED = "\u00c3\u00a2\u00e2\u201a\u00ac\u00e2\u20ac\u009d"; // em dash corrupted twice

// --- mojibake ---

test("repairs the CP-1252 round-trip for common punctuation", () => {
  assert.equal(fixMojibake(`results here ${MOJI_EM_DASH} usually fast`).text, "results here — usually fast");
  assert.equal(fixMojibake(`don${MOJI_RSQUO}t`).text, "don’t");
  assert.equal(fixMojibake(`${MOJI_LDQUO}quoted${MOJI_RDQUO}`).text, "“quoted”");
});

test("repairs two-byte accented-latin mojibake", () => {
  assert.equal(fixMojibake(`caf${MOJI_E_ACUTE}`).text, "café");
  assert.equal(fixMojibake(`S${MOJI_A_TILDE}o Paulo`).text, "São Paulo");
});

test("repairs four-byte (emoji) mojibake", () => {
  assert.equal(fixMojibake(MOJI_EMOJI).text, "\u{1f600}");
});

test("unwinds double-encoded mojibake", () => {
  assert.equal(fixMojibake(MOJI_EM_DASH_DOUBLED).text, "—");
});

test("leaves legitimate Czech place names untouched, but repairs mojibake'd Czech", () => {
  // U-acute + z-caron ("Úž", as in the real place name
  // Úžice from maps/yukina-cz-praha) reverse-decodes to a
  // byte-valid Arabic letter — the plausibility guard must reject that.
  assert.deepEqual(findMojibake("Úžice a Úštěk"), []);
  // ...while genuinely mojibake'd Czech is still repaired.
  assert.equal(fixMojibake(`${MOJI_Z_CARON_UC}elezni`).text, "Železni");
  assert.equal(fixMojibake(`ku${MOJI_Z_CARON}elka`).text, "kuželka");
});

test("leaves legitimate text untouched", () => {
  for (const text of [
    "SÃO PAULO", // uppercase Portuguese: A-tilde-capital followed by ASCII
    "café — naïve résumé", // genuine accents and em dash
    "plain ascii text",
  ]) {
    assert.deepEqual(findMojibake(text), [], `unexpected findings in: ${text}`);
  }
  // A bare pound sign is fine; the A-circumflex-prefixed form is mojibake.
  assert.deepEqual(findMojibake("a £10 note"), []);
  assert.equal(findMojibake(`a ${MOJI_POUND}10 note`).length, 1);
});

test("reports sequence positions and replacements", () => {
  const findings = findMojibake(`x ${MOJI_EM_DASH} y ${MOJI_E_ACUTE} z`);
  assert.equal(findings.length, 2);
  assert.deepEqual(findings.map((f) => f.replacement), ["—", "é"]);
});

// --- BOM / UTF-8 ---

test("detects a UTF-8 BOM", () => {
  assert.equal(hasUtf8Bom(Buffer.from([0xef, 0xbb, 0xbf, 0x7b])), true);
  assert.equal(hasUtf8Bom(Buffer.from('{"a":1}')), false);
});

test("rejects invalid UTF-8", () => {
  assert.equal(decodeStrictUtf8(Buffer.from([0x61, 0xe9, 0x62])), null); // raw CP-1252 e-acute
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
