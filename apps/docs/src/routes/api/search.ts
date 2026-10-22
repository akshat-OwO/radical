import { createFileRoute } from "@tanstack/react-router";
/* oxlint-disable typescript/promise-function-async -- Effect owns the search handler Promise boundary. */
import { Effect } from "effect";
import { createFromSource } from "fumadocs-core/search/server";

import { source } from "../../lib/source";

const search = createFromSource(source, { language: "english" });
export const Route = createFileRoute("/api/search")({
  server: {
    handlers: {
      GET: ({ request }) =>
        Effect.runPromise(Effect.promise(() => search.GET(request))),
    },
  },
});
