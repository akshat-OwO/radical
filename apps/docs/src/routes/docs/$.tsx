/* oxlint-disable typescript/promise-function-async -- Effect owns the route loader Promise boundary. */
import { createFileRoute, notFound } from "@tanstack/react-router";
import { Effect } from "effect";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import mdxComponents from "fumadocs-ui/mdx";
import { use } from "react";

import { source } from "../../lib/source";

const Page = () => {
  const { _splat } = Route.useParams();
  const page = source.getPage(_splat?.split("/").filter(Boolean) ?? []);

  if (!page) {
    return (
      <main>
        <h1>Page not found</h1>
        <a href="/docs">Read the Radical documentation</a>
      </main>
    );
  }

  const { toc } = use(page.data.load());
  const Content = page.data.body;

  return (
    <DocsLayout
      tree={source.pageTree}
      nav={{ title: "Radical" }}
      githubUrl="https://github.com/akshat-OwO/radical"
    >
      <DocsPage toc={toc}>
        <DocsTitle>{page.data.title}</DocsTitle>
        <DocsDescription>{page.data.description}</DocsDescription>
        <DocsBody>
          <Content components={mdxComponents} />
        </DocsBody>
      </DocsPage>
    </DocsLayout>
  );
};

export const Route = createFileRoute("/docs/$")({
  component: Page,
  loader: ({ params }) => {
    const page = source.getPage(
      params._splat?.split("/").filter(Boolean) ?? []
    );

    if (!page) {
      return notFound({ throw: true });
    }

    return Effect.runPromise(Effect.promise(() => page.data.preload()));
  },
  head: ({ params }) => {
    const page = source.getPage(
      params._splat?.split("/").filter(Boolean) ?? []
    );

    return {
      meta: [
        { title: `${page?.data.title ?? "Page not found"} | Radical` },
        {
          name: "description",
          content: page?.data.description ?? "Radical documentation",
        },
      ],
    };
  },
});
