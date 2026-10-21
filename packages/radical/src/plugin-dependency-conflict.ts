import { Schema } from "effect";

export class PluginDependencyConflict extends Schema.TaggedError<
  PluginDependencyConflict,
  { readonly brand: unique symbol }
>()("PluginDependencyConflict", { message: Schema.String }) {}
