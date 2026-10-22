import { Effect } from "effect";

import { Cancelled } from "../../core/errors.ts";

export interface FileInputOptions {
  readonly accept?: string;
  readonly capture?: "environment" | "user";
  readonly multiple?: boolean;
}

/** One hidden input per call, removed on success, cancellation, and interruption. */
export const browserFileInput = (
  doc: Document,
  options: FileInputOptions = {}
) =>
  Effect.suspend(() => {
    const input = doc.createElement("input");
    input.type = "file";
    if (options.accept !== undefined) {
      input.accept = options.accept;
    }
    if (options.capture !== undefined) {
      input.setAttribute("capture", options.capture);
    }
    input.multiple = options.multiple === true;
    input.hidden = true;
    let complete:
      | ((effect: Effect.Effect<readonly File[], Cancelled>) => void)
      | undefined;
    const change = () => {
      const files = [...(input.files ?? [])];
      complete?.(
        files.length > 0
          ? Effect.succeed(files)
          : Effect.fail(new Cancelled({}))
      );
    };
    const cancel = () => complete?.(Effect.fail(new Cancelled({})));
    return Effect.callback<readonly File[], Cancelled>((receive) => {
      complete = receive;
      input.addEventListener("change", change);
      input.addEventListener("cancel", cancel);
      doc.body.append(input);
      input.click();
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          input.removeEventListener("change", change);
          input.removeEventListener("cancel", cancel);
          input.remove();
        })
      )
    );
  });
