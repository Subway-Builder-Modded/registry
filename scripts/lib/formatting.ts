// Formatting invariants for tracked text files: UTF-8 validity, no BOM, no
// CP-1252 mojibake, and canonical JSON style for registry data files.
//
// Mojibake background: an editor that decodes UTF-8 bytes as Windows-1252 and
// re-saves as UTF-8 turns every multi-byte character into a distinctive
// sequence (an em dash becomes the three-character a-circumflex / euro /
// right-double-quote run; e-acute becomes A-tilde-capital / copyright). The
// repair is the exact reverse: map each character of the sequence back to the
// CP-1252 byte it was decoded from, then decode those bytes as UTF-8. A
// candidate is only replaced when that strict decode succeeds AND the result
// is a plausible character — see PLAUSIBLE_REPLACEMENT_RANGES below.
// (This file deliberately contains no literal mojibake examples: it must stay
// clean under its own check. The unit tests build fixtures from \u escapes.)

// CP-1252 bytes 0x80–0x9F map to these codepoints (the range where CP-1252
// differs from Latin-1); bytes 0xA0–0xFF map to the identical codepoints.
const CP1252_HIGH_TO_CODEPOINT: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178,
};

const CODEPOINT_TO_CP1252_BYTE = new Map<number, number>();
for (const [byte, codepoint] of Object.entries(CP1252_HIGH_TO_CODEPOINT)) {
  CODEPOINT_TO_CP1252_BYTE.set(codepoint, Number(byte));
}

/** The CP-1252 byte this character would have been decoded from, or null. */
function charToCp1252Byte(char: string): number | null {
  const codepoint = char.codePointAt(0)!;
  const mapped = CODEPOINT_TO_CP1252_BYTE.get(codepoint);
  if (mapped !== undefined) return mapped;
  // 0x80-0xFF: Latin-1 passthrough, including the five codepoints CP-1252
  // leaves undefined (0x81, 0x8D, 0x8F, 0x90, 0x9D) — editors commonly carry
  // those through as C1 controls.
  if (codepoint >= 0x80 && codepoint <= 0xff) return codepoint;
  return null;
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

// A candidate repair is only accepted when the decoded character is one that
// plausibly appears in registry prose. This guards against real-text
// collisions: Czech "Úžice" reverse-decodes to a byte-valid Arabic letter
// (U-acute = 0xDA lead + z-caron = 0x9E continuation), so strict UTF-8
// validity alone is not sufficient evidence of mojibake. Genuine mojibake of
// Czech text is still repaired — corrupted z-caron reverse-decodes back into
// Latin Extended-A, inside this allowlist.
const PLAUSIBLE_REPLACEMENT_RANGES: Array<[number, number]> = [
  [0x00a0, 0x024f], // Latin-1 supplement, Latin Extended-A/B
  [0x0370, 0x04ff], // Greek, Cyrillic
  [0x1e00, 0x1eff], // Latin Extended Additional
  [0x2000, 0x206f], // general punctuation (dashes, quotes, ellipsis, bullet)
  [0x20a0, 0x20cf], // currency symbols
  [0x2100, 0x214f], // letterlike symbols (™, №)
  [0x2600, 0x27bf], // misc symbols, dingbats
  [0x3000, 0x30ff], // CJK punctuation, kana
  [0x4e00, 0x9fff], // CJK unified ideographs
  [0xfe00, 0xfe0f], // variation selectors (emoji presentation)
  [0x1f300, 0x1faff], // emoji
];

function isPlausibleReplacement(replacement: string): boolean {
  const codepoint = replacement.codePointAt(0)!;
  return PLAUSIBLE_REPLACEMENT_RANGES.some(([lo, hi]) => codepoint >= lo && codepoint <= hi);
}

export interface MojibakeFinding {
  index: number;
  sequence: string;
  replacement: string;
}

/**
 * Finds CP-1252 mojibake sequences: a character mapping to a UTF-8 lead byte
 * (0xC2–0xF4) followed by exactly the right number of characters mapping to
 * continuation bytes (0x80–0xBF), where the reassembled bytes strictly decode
 * as UTF-8. Single-pass; call fixMojibake for iterated (double-encoded) repair.
 */
export function findMojibake(text: string): MojibakeFinding[] {
  const findings: MojibakeFinding[] = [];
  for (let i = 0; i < text.length; i++) {
    const lead = charToCp1252Byte(text[i]!);
    if (lead === null || lead < 0xc2 || lead > 0xf4) continue;
    const continuations = lead < 0xe0 ? 1 : lead < 0xf0 ? 2 : 3;
    if (i + continuations >= text.length) continue;
    const bytes = [lead];
    let valid = true;
    for (let j = 1; j <= continuations; j++) {
      const byte = charToCp1252Byte(text[i + j]!);
      if (byte === null || byte < 0x80 || byte > 0xbf) {
        valid = false;
        break;
      }
      bytes.push(byte);
    }
    if (!valid) continue;
    let replacement: string;
    try {
      replacement = strictUtf8.decode(Uint8Array.from(bytes));
    } catch {
      continue;
    }
    if (!isPlausibleReplacement(replacement)) continue;
    findings.push({ index: i, sequence: text.slice(i, i + continuations + 1), replacement });
    i += continuations;
  }
  return findings;
}

/** Repairs mojibake, unwinding double-encoding by iterating until stable. */
export function fixMojibake(text: string): { text: string; replacements: number } {
  let current = text;
  let replacements = 0;
  for (let pass = 0; pass < 4; pass++) {
    const findings = findMojibake(current);
    if (findings.length === 0) break;
    let result = "";
    let cursor = 0;
    for (const finding of findings) {
      result += current.slice(cursor, finding.index) + finding.replacement;
      cursor = finding.index + finding.sequence.length;
    }
    result += current.slice(cursor);
    current = result;
    replacements += findings.length;
  }
  return { text: current, replacements };
}

export const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export function hasUtf8Bom(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer.subarray(0, 3).equals(UTF8_BOM);
}

export function decodeStrictUtf8(buffer: Buffer): string | null {
  try {
    return strictUtf8.decode(buffer);
  } catch {
    return null;
  }
}

/**
 * Canonical JSON style: exactly what every writer in this repo emits —
 * JSON.stringify(value, null, 2) with a trailing newline, key order preserved.
 * Returns null when the text is not parseable JSON.
 */
export function canonicalizeJsonText(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return `${JSON.stringify(parsed, null, 2)}\n`;
}
