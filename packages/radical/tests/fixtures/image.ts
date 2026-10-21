// oxlint-disable typescript/promise-function-async -- Effect owns this Promise boundary.
import { Effect } from "effect";
import sharp from "sharp";

/** Test-owned image pixels, without files or native generator processes. */
export const image = (size: number, background = "#663399") =>
  Effect.promise(() =>
    sharp({ create: { width: size, height: size, channels: 4, background } })
      .png()
      .toBuffer()
  );
