// oxlint-disable eslint/max-classes-per-file -- Related typed failures share their owning concept module.
import { Schema } from "effect";

export class AssetGenerationFailed extends Schema.TaggedError<AssetGenerationFailed>()(
  "AssetGenerationFailed",
  {
    message: Schema.String,
  }
) {}

export class InvalidAsset extends Schema.TaggedError<InvalidAsset>()(
  "InvalidAsset",
  {
    message: Schema.String,
  }
) {}
