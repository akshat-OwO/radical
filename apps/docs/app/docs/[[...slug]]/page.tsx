import { Effect } from "effect";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
/* oxlint-disable typescript/promise-function-async -- Effect owns Next.js route Promise boundaries. */
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { mdxComponents } from "../../../components/mdx";
import { source } from "../../../lib/source";

interface PageProps {
  params: Promise<{ slug?: string[] }>;
}

export const dynamicParams = false;

export const generateStaticParams = () => source.generateParams();

export const generateMetadata = ({ params }: PageProps): Promise<Metadata> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { slug } = yield* Effect.promise(() => params);
      const page = source.getPage(slug);

      if (!page) {
        return notFound();
      }

      return { title: page.data.title, description: page.data.description };
    })
  );

const Page = ({ params }: PageProps) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { slug } = yield* Effect.promise(() => params);
      const page = source.getPage(slug);

      if (!page) {
        return notFound();
      }

      const Content = page.data.body;

      return (
        <DocsPage toc={page.data.toc} full={page.data.full}>
          <DocsTitle>{page.data.title}</DocsTitle>
          <DocsDescription>{page.data.description}</DocsDescription>
          <DocsBody>
            <Content components={mdxComponents} />
          </DocsBody>
        </DocsPage>
      );
    })
  );

export default Page;
