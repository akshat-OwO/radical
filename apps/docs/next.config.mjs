import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import("next").NextConfig} */
const config = {
  reactStrictMode: true,
  experimental: { cpus: 2 },
};

export default withMDX(config);
