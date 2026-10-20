import { Schema } from "effect";

export class AndroidBootTimeout extends Schema.TaggedError<
  AndroidBootTimeout,
  { readonly brand: unique symbol }
>()("AndroidBootTimeout", { target: Schema.String, serial: Schema.String }) {
  override get message() {
    return `Android target ${this.target} (${this.serial}) did not finish booting within 120 seconds`;
  }
}
