import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parse } from "@babel/parser";
import type { Node } from "@babel/types";
import { isFunction, traverse } from "@babel/types";
import { assert, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  capacitorAllowedFiles,
  capacitorScopes,
} from "./capacitor-boundary-policy.ts";

const scopes = new RegExp(capacitorScopes, "u");
const allowed = new Set(capacitorAllowedFiles);
const root = fileURLToPath(new URL("../../../", import.meta.url));

type Binding = "factory" | "require" | undefined;

type Bindings = Map<string, Binding>;

// Follow createRequire results and simple aliases in lexical scopes. Computed
// specifiers and general data flow are deliberately outside this policy.
const bindingOf = (
  node: Node | null | undefined,
  bindings: Bindings
): Binding => {
  if (node?.type === "Identifier") {
    return bindings.get(node.name);
  }

  if (
    node?.type === "CallExpression" &&
    bindingOf(node.callee, bindings) === "factory"
  ) {
    return "require";
  }

  return undefined;
};

const isRequire = (node: Node, bindings: Bindings): boolean =>
  bindingOf(node, bindings) === "require" ||
  (node.type === "MemberExpression" &&
    !node.computed &&
    node.property.type === "Identifier" &&
    node.property.name === "resolve" &&
    bindingOf(node.object, bindings) === "require");

const updateBindings = (node: Node, bindings: Bindings) => {
  if (isFunction(node)) {
    for (const param of node.params) {
      if (param.type === "Identifier") {
        bindings.set(param.name, undefined);
      }
    }
  } else if (node.type === "ImportDeclaration") {
    for (const specifier of node.specifiers) {
      const isFactory =
        (node.source.value === "node:module" ||
          node.source.value === "module") &&
        specifier.type === "ImportSpecifier" &&
        specifier.imported.type === "Identifier" &&
        specifier.imported.name === "createRequire";

      bindings.set(specifier.local.name, isFactory ? "factory" : undefined);
    }
  } else if (
    node.type === "VariableDeclarator" &&
    node.id.type === "Identifier"
  ) {
    bindings.set(node.id.name, bindingOf(node.init, bindings));
  } else if (
    node.type === "AssignmentExpression" &&
    node.operator === "=" &&
    node.left.type === "Identifier"
  ) {
    bindings.set(node.left.name, bindingOf(node.right, bindings));
  }
};

const opensScope = (node: Node) =>
  node.type === "Program" || node.type === "BlockStatement" || isFunction(node);

const restrictedLoads = (source: string) => {
  const ast = parse(source, {
    sourceType: "unambiguous",
    plugins: ["typescript", "jsx"],
    createImportExpressions: true,
  });

  const imports: string[] = [];

  const record = (argument: Node | null | undefined) => {
    let value: string | null | undefined;

    if (argument?.type === "StringLiteral") {
      ({ value } = argument);
    } else if (argument?.type === "TemplateLiteral") {
      value = argument.quasis[0]?.value.cooked;
    }

    if (value !== undefined && value !== null && scopes.test(value)) {
      imports.push(value);
    }
  };

  let bindings = new Map<string, Binding>([
    ["require", "require"],
    ["createRequire", "factory"],
  ]);

  const parents: Bindings[] = [];
  traverse(ast, {
    enter(node) {
      if (opensScope(node)) {
        parents.push(bindings);
        bindings = new Map(bindings);
      }

      updateBindings(node, bindings);

      if (node.type === "ImportExpression") {
        record(node.source);
      } else if (node.type === "TSImportType") {
        record(node.argument);
      } else if (
        node.type === "CallExpression" &&
        isRequire(node.callee, bindings)
      ) {
        record(node.arguments[0]);
      }
    },
    exit(node) {
      if (opensScope(node)) {
        const parent = parents.pop();

        if (parent) {
          bindings = parent;
        }
      }
    },
  });

  return imports;
};

const violationsIn = (file: string, source: string) =>
  allowed.has(file)
    ? []
    : restrictedLoads(source).map((specifier) => `${file}: ${specifier}`);

it.effect("detects dynamic Capacitor imports with quotes or templates", () =>
  Effect.sync(() => {
    assert.deepStrictEqual(
      restrictedLoads(
        [
          'import("@capacitor/core")',
          "import /* comment */ (`@capgo/camera-preview`)",
          // oxlint-disable-next-line no-template-curly-in-string -- Source fixture for an interpolated import.
          "import(`@capawesome/capacitor-file-picker/${file}`)",
          'type Device = typeof import("@capacitor/device")',
          'import("@capacitor-community/file-opener/dist/esm/index.js")',
        ].join(";\n")
      ),
      [
        "@capacitor/core",
        "@capgo/camera-preview",
        "@capawesome/capacitor-file-picker/",
        "@capacitor/device",
        "@capacitor-community/file-opener/dist/esm/index.js",
      ]
    );
    assert.deepStrictEqual(
      restrictedLoads(
        [
          '// import("@capacitor/core")',
          "/* import(`@capgo/camera-preview`) */",
          "const example = 'import(\"@capacitor/device\")'",
          'import("effect")',
          'import("@capacitor-other/plugin")',
        ].join(";\n")
      ),
      []
    );
  })
);

const callForms = [
  ["require", "", "require"],
  ["require.resolve", "", "require.resolve"],
  [
    "chained createRequire.resolve",
    "",
    "createRequire(import.meta.url).resolve",
  ],
  ["chained createRequire", "", "createRequire(import.meta.url)"],
  [
    "bound createRequire.resolve",
    "const r = createRequire(import.meta.url);",
    "r.resolve",
  ],
  ["bound createRequire", "let r = createRequire(import.meta.url);", "r"],
  ["var binding", "var r = createRequire(import.meta.url);", "r.resolve"],
  ["assigned binding", "let r; r = createRequire(import.meta.url);", "r"],
  [
    "same-scope alias",
    "const r = createRequire(import.meta.url); const alias = r;",
    "alias.resolve",
  ],
  [
    "callable alias",
    "const r = createRequire(import.meta.url); const alias = r;",
    "alias",
  ],
  [
    "renamed factory",
    'import { createRequire as makeRequire } from "node:module"; const r = makeRequire(import.meta.url);',
    "r.resolve",
  ],
] as const;

// oxlint-disable no-template-curly-in-string -- In-memory source fixtures preserve template syntax.
const specifiers = [
  ['"@capacitor/core"', "@capacitor/core"],
  ["`@capgo/camera-preview`", "@capgo/camera-preview"],
  [
    "`@capawesome/capacitor-file-picker/${file}`",
    "@capawesome/capacitor-file-picker/",
  ],
  ["`@capacitor-community/${plugin}`", "@capacitor-community/"],
] as const;

for (const [name, setup, callee] of callForms) {
  for (const [argument, expected] of specifiers) {
    it.effect(
      `rejects ${name}(${argument}) outside the allowlist and permits it inside`,
      () =>
        Effect.sync(() => {
          const source = `${setup} ${callee}(${argument})`;

          for (const file of [
            "packages/radical/src/forbidden.ts",
            "apps/example/src/forbidden.ts",
            "packages/radical/tests/forbidden.test.ts",
          ]) {
            assert.deepStrictEqual(violationsIn(file, source), [
              `${file}: ${expected}`,
            ]);
          }

          for (const file of capacitorAllowedFiles) {
            assert.deepStrictEqual(violationsIn(file, source), []);
          }
        })
    );
  }

  it.effect(`ignores computed and unrelated specifiers in ${name}`, () =>
    Effect.sync(() => {
      for (const argument of [
        "name",
        "`effect`",
        '"@capacitor-other/plugin"',
        "`${scope}/core`",
        "`@capacitor${suffix}/core`",
        "...names",
      ]) {
        assert.deepStrictEqual(
          restrictedLoads(`${setup} ${callee}(${argument})`),
          []
        );
      }
    })
  );
}

it.effect("keeps require aliases within their lexical scope", () =>
  Effect.sync(() => {
    assert.deepStrictEqual(
      restrictedLoads(`
      { const r = createRequire(import.meta.url); r("@capacitor/core"); }
      r("@capacitor/device");
      function unrelated(r: Function) { r.resolve("@capacitor/core"); }
      const r = createRequire(import.meta.url);
      { const r = other; r("@capacitor/core"); }
      r.resolve("@capacitor/device");
    `),
      ["@capacitor/core", "@capacitor/device"]
    );
  })
);

it.effect(
  "ignores computed imports and leaves import assignments to Oxlint",
  () =>
    Effect.sync(() => {
      assert.deepStrictEqual(
        restrictedLoads('import x = require("@capacitor/core")'),
        []
      );
      assert.deepStrictEqual(
        restrictedLoads("import(name); import(`${scope}/core`)"),
        []
      );
    })
);

// oxlint-enable no-template-curly-in-string

it.effect(
  "keeps Capacitor imports and require calls inside the allowed modules",
  () =>
    Effect.sync(() => {
      const files = globSync(
        [
          "packages/radical/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}",
          "apps/example/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}",
        ],
        {
          cwd: root,
          exclude: [
            "**/node_modules/**",
            "**/dist/**",
            "**/.radical/**",
            "**/.output/**",
          ],
        }
      ).toSorted();

      assert.isAbove(files.length, 0);

      const violations = files.flatMap((file) =>
        violationsIn(
          file,
          readFileSync(
            new URL(file, new URL("../../../", import.meta.url)),
            "utf-8"
          )
        )
      );

      assert.deepStrictEqual(violations, []);
    })
);
