"use client";

/* oxlint-disable typescript/promise-function-async -- Effect owns Promise boundaries. */
import { Effect, Fiber, Schema, Semaphore } from "effect";
import { useTheme } from "next-themes";
import { useEffect, useId, useState } from "react";

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is an Effect class factory.
class MermaidRenderFailed extends Schema.TaggedError<
  MermaidRenderFailed,
  { readonly brand: unique symbol }
>()("MermaidRenderFailed", { cause: Schema.Unknown }) {}

// Mermaid configuration is global. Keep initialization and rendering together.
const renderer = Semaphore.makeUnsafe(1);

const loadMermaid = Effect.tryPromise({
  try: () => import("mermaid"),
  catch: (cause) => new MermaidRenderFailed({ cause }),
});

const renderChart = (id: string, chart: string, theme: string | undefined) =>
  renderer.withPermits(1)(
    Effect.gen(function* () {
      const { default: mermaid } = yield* loadMermaid;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        fontFamily: "inherit",
        theme: theme === "dark" ? "dark" : "default",
      });

      return yield* Effect.tryPromise({
        try: () => mermaid.render(`mermaid-${id}`, chart),
        catch: (cause) => new MermaidRenderFailed({ cause }),
      });
    }).pipe(Effect.uninterruptible)
  );

/** Client-only renderer following https://fumadocs.dev/docs/markdown/mermaid. */
export const Mermaid = ({ chart, title }: { chart: string; title: string }) => {
  const id = useId().replaceAll(":", "");
  const { resolvedTheme } = useTheme();
  const [result, setResult] = useState({ svg: "", failed: false, theme: "" });

  useEffect(() => {
    const fiber = Effect.runFork(
      renderChart(id, chart, resolvedTheme).pipe(
        Effect.tap(({ svg }) =>
          Effect.sync(() => {
            setResult({ svg, failed: false, theme: resolvedTheme ?? "light" });
          })
        ),
        Effect.catchTag("MermaidRenderFailed", () =>
          Effect.sync(() => {
            setResult({
              svg: "",
              failed: true,
              theme: resolvedTheme ?? "light",
            });
          })
        )
      )
    );

    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [chart, id, resolvedTheme]);

  return (
    <figure
      className="my-6 overflow-x-auto rounded-lg border p-4"
      aria-label={title}
    >
      <figcaption className="text-fd-muted-foreground mb-3 text-sm">
        {title}
      </figcaption>
      {result.svg ? (
        <div
          data-mermaid-theme={result.theme}
          // oxlint-disable-next-line react/no-danger -- Mermaid strict mode sanitizes the SVG.
          dangerouslySetInnerHTML={{ __html: result.svg }}
        />
      ) : (
        <pre
          className="text-sm whitespace-pre-wrap"
          role={result.failed ? "alert" : undefined}
        >
          {result.failed ? `Diagram could not render.\n${chart}` : chart}
        </pre>
      )}
    </figure>
  );
};
