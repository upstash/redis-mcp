import { describe, expect, test } from "bun:test";
import { isNonRetryable } from "./rest";

describe("isNonRetryable", () => {
  // Permanent URL/scheme errors — wording differs across Node and Bun, and the
  // real reason is sometimes only in `cause`. All must be treated as fatal.
  const permanent: Array<[string, TypeError]> = [
    [
      "Node bad URL",
      new TypeError("Failed to parse URL from xxx.upstash.io", { cause: new Error("Invalid URL") }),
    ],
    ["Node bad scheme", new TypeError("fetch failed", { cause: new Error("unknown scheme") })],
    ["Bun bad URL", new TypeError("fetch() URL is invalid")],
    ["Bun bad scheme", new TypeError("protocol must be http:, https: or s3:")],
  ];
  for (const [name, error] of permanent) {
    test(`non-retryable: ${name}`, () => expect(isNonRetryable(error)).toBe(true));
  }

  // Transient network failures must still retry.
  const transient: Array<[string, unknown]> = [
    [
      "DNS failure",
      new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND db.upstash.io") }),
    ],
    [
      "connection refused",
      new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED") }),
    ],
    ["plain fetch failed", new TypeError("fetch failed")],
    ["non-TypeError", new Error("Failed to parse URL")],
  ];
  for (const [name, error] of transient) {
    test(`retryable: ${name}`, () => expect(isNonRetryable(error)).toBe(false));
  }
});
