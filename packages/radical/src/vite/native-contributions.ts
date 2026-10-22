export interface PlistContribution {
  readonly key: string;
  /** XML value, except for unique-purpose entries which carry unescaped text. */
  readonly value: string;
  readonly composition?: "unique-purpose";
  readonly order?: number;
  readonly stage?: "postprocess";
}
export interface NativeEdit {
  readonly platform: "android" | "ios";
  readonly file: string;
  readonly anchor: string | RegExp;
  readonly replacement: string;
}
export interface NativeContributions {
  readonly android?: readonly string[];
  readonly plist?: readonly PlistContribution[];
  readonly defines?: Readonly<Record<string, string>>;
  readonly spm?: Readonly<Record<string, { readonly symlink: boolean }>>;
  readonly entitlements?: Readonly<Record<string, string>>;
  readonly appDelegateHooks?: readonly string[];
  readonly edits?: readonly NativeEdit[];
  readonly files?: readonly {
    readonly platform: "android" | "ios";
    readonly file: string;
    readonly contents: string;
  }[];
  readonly copies?: readonly {
    readonly platform: "android" | "ios";
    readonly source: string;
    readonly file: string;
  }[];
}
export const escapeXml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
