// oxlint-disable eslint/max-classes-per-file -- Related typed failures share their owning concept module.
import { Schema } from "effect";

export class InvalidPlugin extends Schema.TaggedError<
  InvalidPlugin,
  { readonly brand: unique symbol }
>()("InvalidPlugin", { message: Schema.String }) {}

export class PluginDependencyConflict extends Schema.TaggedError<
  PluginDependencyConflict,
  { readonly brand: unique symbol }
>()("PluginDependencyConflict", { message: Schema.String }) {}
