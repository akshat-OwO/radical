import path from "node:path";

import { Effect, FileSystem } from "effect";

import type { BuildPlan } from "../../vite/build-plan.ts";
import { replaceAnchor } from "./native-template.ts";

export const applyBuildPlan = (
  root: string,
  staging: string,
  platform: "android" | "ios",
  plan: Pick<BuildPlan, "edits" | "files" | "copies">
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    for (const copy of plan.copies) {
      if (copy.platform === platform) {
        yield* fs.copyFile(
          path.resolve(root, copy.source),
          path.join(staging, copy.file)
        );
      }
    }
    for (const file of plan.files) {
      if (file.platform === platform) {
        yield* fs.writeFileString(path.join(staging, file.file), file.contents);
      }
    }
    for (const edit of plan.edits) {
      if (edit.platform === platform) {
        const file = path.join(staging, edit.file);
        yield* fs.writeFileString(
          file,
          yield* replaceAnchor(
            file,
            yield* fs.readFileString(file),
            edit.anchor,
            edit.replacement
          )
        );
      }
    }
  });
