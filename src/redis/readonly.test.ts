import { describe, expect, test } from "bun:test";
import { assertReadOnly, isReadOnlyCommand } from "./readonly";

describe("isReadOnlyCommand", () => {
  test("read commands are allowed", () => {
    expect(isReadOnlyCommand(["GET", "k"])).toBe(true);
    expect(isReadOnlyCommand(["scan", "0"])).toBe(true); // case-insensitive
    expect(isReadOnlyCommand(["HGETALL", "h"])).toBe(true);
    expect(isReadOnlyCommand(["SEARCH.QUERY", "idx", "{}"])).toBe(true); // Upstash search read
    expect(isReadOnlyCommand(["SEARCH.LISTINDEXES", "MATCH", "*"])).toBe(true); // index discovery
  });

  test("write / dangerous commands are not allowed", () => {
    expect(isReadOnlyCommand(["SET", "k", "v"])).toBe(false);
    expect(isReadOnlyCommand(["DEL", "k"])).toBe(false);
    expect(isReadOnlyCommand(["FLUSHALL"])).toBe(false);
    expect(isReadOnlyCommand(["EVAL", "return 1", "0"])).toBe(false);
    expect(isReadOnlyCommand(["SORT", "k", "STORE", "dst"])).toBe(false);
    expect(isReadOnlyCommand(["SEARCH.CREATE", "idx"])).toBe(false); // search index write
  });
});

describe("assertReadOnly", () => {
  test("passes for all-read batches", () => {
    expect(() =>
      assertReadOnly([
        ["GET", "a"],
        ["TTL", "a"],
      ])
    ).not.toThrow();
  });

  test("throws and names the blocked commands", () => {
    expect(() => assertReadOnly([["GET", "a"], ["SET", "a", "1"], ["FLUSHDB"]])).toThrow(
      /SET, FLUSHDB/
    );
  });
});
