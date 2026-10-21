import { Schema } from "effect";

export class AssetGenerationFailed extends Schema.TaggedError<AssetGenerationFailed>()(
  "AssetGenerationFailed",
  {
    message: Schema.String,
  }
) {}
