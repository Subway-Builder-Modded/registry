/**
 * Shared CLI argv primitives.
 *
 * These are lenient scanners: unknown arguments are ignored. Scripts that need
 * strict validation (unknown-argument errors, positional handling, per-flag
 * error messages) keep their own parse loops.
 */

/**
 * Return the value for `--flag=value` (checked first, anywhere in argv) or
 * `--flag value`, or undefined when the flag is absent.
 */
export function getFlagValue(argv: string[], flag: string): string | undefined {
  const exact = `--${flag}=`;
  for (const arg of argv) {
    if (arg.startsWith(exact)) {
      return arg.slice(exact.length);
    }
  }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === `--${flag}`) {
      return argv[index + 1];
    }
  }
  return undefined;
}

/** True when argv contains the bare `--flag` token. */
export function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(`--${flag}`);
}
