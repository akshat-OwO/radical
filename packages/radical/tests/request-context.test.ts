import vm from "node:vm";

import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { requestContextScript } from "../src/android.ts";
import { NATIVE_CONTEXT_HEADER } from "../src/native-context.ts";

const sandbox = () => {
  class MemoryXHR {
    method = "";
    body: string | undefined;
    readonly headers = new Map<string, string>();
    open(method: string, _url: string) {
      this.method = method;
      this.headers.clear();
    }
    send(body?: string) {
      this.body = body;
    }
    setRequestHeader(name: string, value: string) {
      this.headers.set(name, value);
    }
  }
  const window = { fetch: (input: Request) => input };
  const context = vm.createContext({
    window,
    Request,
    Headers,
    URL,
    XMLHttpRequest: MemoryXHR,
    location: { href: "https://app.example/" },
  });
  const script = requestContextScript(
    NATIVE_CONTEXT_HEADER,
    "encoded-context",
    ["https://app.example"]
  );
  new vm.Script(script).runInContext(context);
  return { window, MemoryXHR };
};

describe("document-start native context", () => {
  it.effect(
    "adds context to allowed fetch requests while preserving POST bodies and headers",
    () =>
      Effect.gen(function* () {
        const { window } = sandbox();
        const result = window.fetch(
          new Request("https://app.example/action", {
            method: "POST",
            body: "payload",
            headers: { "x-existing": "keep" },
            credentials: "include",
          })
        );
        assert.strictEqual(
          result.headers.get(NATIVE_CONTEXT_HEADER),
          "encoded-context"
        );
        assert.strictEqual(result.headers.get("x-existing"), "keep");
        assert.strictEqual(result.credentials, "include");
        assert.strictEqual(result.method, "POST");
        assert.strictEqual(
          yield* Effect.promise(async () => await result.text()),
          "payload"
        );
      })
  );

  it.effect(
    "does not send native context to a different origin or a hostname prefix attack",
    () =>
      Effect.sync(() => {
        const { window } = sandbox();
        for (const url of [
          "https://external.example/",
          "https://app.example.evil.test/",
          "http://app.example/",
          "https://app.example:444/",
        ]) {
          const result = window.fetch(new Request(url));
          assert.isNull(result.headers.get(NATIVE_CONTEXT_HEADER));
        }
      })
  );

  it.effect(
    "adds context to allowed XHR requests and clears the decision when XHR is reused",
    () =>
      Effect.sync(() => {
        const { MemoryXHR } = sandbox();
        const xhr = new MemoryXHR();
        xhr.open("POST", "/action");
        xhr.send("body");
        assert.strictEqual(
          xhr.headers.get(NATIVE_CONTEXT_HEADER),
          "encoded-context"
        );
        xhr.headers.clear();
        xhr.open("GET", "https://external.example/");
        xhr.send();
        assert.strictEqual(xhr.headers.size, 0);
      })
  );
});
