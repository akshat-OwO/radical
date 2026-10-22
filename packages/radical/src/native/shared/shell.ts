import { Effect, FileSystem, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

export class ShellCommandError extends Schema.TaggedError<
  ShellCommandError,
  { readonly brand: unique symbol }
>()("ShellCommandError", { command: Schema.String, exitCode: Schema.Finite }) {
  override get message() {
    return `${this.command} exited with code ${this.exitCode}`;
  }
}

/** One command boundary for generation and platform runners, replaceable in tests. */
export const execute = (
  command: string,
  args: readonly string[],
  cwd: string,
  options: { capture?: boolean; allowAlreadyBooted?: boolean } = {}
) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    if (options.capture === true) {
      return yield* Effect.scoped(
        Effect.gen(function* () {
          const process = yield* spawner.spawn(
            ChildProcess.make(command, args, {
              cwd,
              stdout: "pipe",
              stderr: "pipe",
            })
          );

          const [stdout, stderr, exitCode] = yield* Effect.all(
            [
              Stream.mkString(Stream.decodeText(process.stdout)),
              Stream.mkString(Stream.decodeText(process.stderr)),
              process.exitCode,
            ],
            { concurrency: "unbounded" }
          );

          if (
            exitCode !== 0 &&
            !(
              options.allowAlreadyBooted === true &&
              stderr.includes("current state: Booted")
            )
          ) {
            return yield* Effect.fail(
              new ShellCommandError({ command, exitCode })
            );
          }

          return stdout;
        })
      );
    }

    const exitCode = yield* spawner.exitCode(
      ChildProcess.make(command, args, {
        cwd,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      })
    );

    yield* exitCode === 0
      ? Effect.void
      : Effect.fail(new ShellCommandError({ command, exitCode }));

    return "";
  });

/** Publish only a fully generated project. Failed generation keeps the previous shell usable. */
export const replaceProject = <A, E, R>(
  destination: string,
  generate: (staging: string) => Effect.Effect<A, E, R>
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const staging = `${destination}.next`;
    yield* fs.remove(staging, { recursive: true, force: true });
    yield* fs.makeDirectory(staging, { recursive: true });
    yield* generate(staging).pipe(
      Effect.onError(() =>
        fs.remove(staging, { recursive: true, force: true }).pipe(Effect.orDie)
      )
    );
    yield* fs.remove(destination, { recursive: true, force: true });
    yield* fs.rename(staging, destination);

    return destination;
  });
