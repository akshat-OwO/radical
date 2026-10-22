import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";

import { source } from "../../lib/source";

const Layout = ({ children }: { children: ReactNode }) => (
  <DocsLayout
    tree={source.pageTree}
    nav={{ title: "Radical" }}
    githubUrl="https://github.com/akshat-OwO/radical"
  >
    {children}
  </DocsLayout>
);

export default Layout;
