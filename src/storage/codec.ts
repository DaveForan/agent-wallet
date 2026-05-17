/**
 * JSON codec for durable storage.
 *
 * `Money.amount` is a bigint, which `JSON.stringify` cannot round-trip — so
 * bigints are tagged on the way out and revived on the way in. This is the
 * *internal storage* encoding, deliberately distinct from `bigintReplacer`
 * (which renders bigints as plain strings for API clients, a lossy form).
 */

const BIGINT_TAG = "$bigint";

/** Serialize a value to a JSON string, preserving bigints losslessly. */
export function encode(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) =>
    typeof val === "bigint" ? { [BIGINT_TAG]: val.toString() } : val,
  );
}

/** Parse a JSON string produced by {@link encode}, restoring bigints. */
export function decode<T>(json: string): T {
  return JSON.parse(json, (_key, val: unknown) => {
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      const keys = Object.keys(val);
      const tagged = (val as Record<string, unknown>)[BIGINT_TAG];
      if (keys.length === 1 && keys[0] === BIGINT_TAG && typeof tagged === "string") {
        return BigInt(tagged);
      }
    }
    return val;
  }) as T;
}
