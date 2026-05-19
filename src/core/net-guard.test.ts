import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { assertSafeUrl } from "./net-guard.ts";

describe("assertSafeUrl", () => {
  test("allows an ordinary public https URL", () => {
    assert.doesNotThrow(() => assertSafeUrl("https://api.example.com/x"));
  });

  test("blocks the cloud-metadata address", () => {
    assert.throws(() => assertSafeUrl("http://169.254.169.254/latest/meta-data"));
  });

  test("blocks loopback, private and unspecified IPv4 addresses", () => {
    for (const url of [
      "http://127.0.0.1/",
      "http://10.0.0.5/",
      "http://192.168.1.1/",
      "http://172.16.0.1/",
      "http://0.0.0.0/",
    ]) {
      assert.throws(() => assertSafeUrl(url), new RegExp("SSRF"), url);
    }
  });

  test("blocks the localhost hostname", () => {
    assert.throws(() => assertSafeUrl("http://localhost:4021/paid"));
  });

  test("blocks an IPv6 loopback literal", () => {
    assert.throws(() => assertSafeUrl("http://[::1]:8080/"));
  });

  test("blocks a non-HTTP(S) scheme", () => {
    assert.throws(() => assertSafeUrl("file:///etc/passwd"));
    assert.throws(() => assertSafeUrl("ftp://example.com/"));
  });

  test("allowPrivate opts out — for local testing", () => {
    assert.doesNotThrow(() =>
      assertSafeUrl("http://127.0.0.1:4021/", { allowPrivate: true }),
    );
  });

  test("rejects a malformed URL", () => {
    assert.throws(() => assertSafeUrl("not a url"));
  });
});
