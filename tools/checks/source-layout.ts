import { dirname, posix } from "node:path";
import { readFile, stat } from "node:fs/promises";
import ts from "typescript";

const entryPoints: Record<string, readonly string[]> = {
  "native/capture/": [
    "build-macos.py",
    "build-windows.py",
    "runtime-fingerprint.py",
  ],
  "apps/api/src/": [
    "app.ts",
    "main.ts",
    "admin-cli.ts",
    "export-openapi.ts",
    "config.ts",
  ],
  "apps/desktop/src/main/": ["index.ts"],
  "apps/desktop/src/renderer/": [
    "controller.ts",
    "store.ts",
    "platform.ts",
    "server-address.ts",
    "src.tsx",
    "env.d.ts",
    "index.html",
    "watch.html",
  ],
  "apps/desktop/src/renderer/ui/": [
    "App.tsx",
    "Provider.tsx",
    "Modal.tsx",
    "Dialogs.tsx",
    "Feedback.tsx",
    "Presence.tsx",
    "styles.tsx",
    "useRetainedDialog.ts",
    "WindowControls.tsx",
  ],
  "tools/": [
    "setup.ts",
    "dev.ts",
    "check-git.ts",
    "windows-audio-build.ts",
    "native-maintenance.py",
    "native-backup.sh",
    "native-renew-certificate.sh",
    "production-backup.sh",
  ],
};
type LayoutIssue = { file: string; message: string };

function moduleReferences(file: string, source: string) {
  const references: string[] = [];
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node)) {
      const parent = node.parent;
      if (
        ((ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) &&
          parent.moduleSpecifier === node) ||
        (ts.isCallExpression(parent) &&
          parent.expression.kind === ts.SyntaxKind.ImportKeyword &&
          parent.arguments[0] === node) ||
        (ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent))
      )
        references.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return references;
}

export function inspectSourceLayout(
  files: ReadonlyMap<string, string>,
): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  for (const [file, source] of files) {
    for (const [directory, allowed] of Object.entries(entryPoints)) {
      const name = file.startsWith(directory)
        ? file.slice(directory.length)
        : undefined;
      if (name && !name.includes("/") && !allowed.includes(name))
        issues.push({
          file,
          message: "Place business implementation inside its domain directory",
        });
    }
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    for (const reference of moduleReferences(file, source)) {
      if (!reference.startsWith(".")) continue;
      const target = posix.normalize(
        posix.join(dirname(file), reference.split("?")[0]!),
      );
      if (file.startsWith("packages/") && target.startsWith("apps/"))
        issues.push({
          file,
          message:
            "Shared packages must not import application implementations: " +
            reference,
        });
      const candidates = [
        target,
        ...[
          ".ts",
          ".tsx",
          ".js",
          ".jsx",
          ".json",
          "/index.ts",
          "/index.tsx",
          "/index.js",
        ].map((suffix) => target + suffix),
      ];
      if (/\.[cm]?jsx?$/.test(target))
        candidates.push(
          target.replace(/\.[cm]?jsx?$/, ".ts"),
          target.replace(/\.[cm]?jsx?$/, ".tsx"),
        );
      if (!candidates.some((candidate) => files.has(candidate)))
        issues.push({
          file,
          message: "Missing relative module or asset: " + reference,
        });
    }
  }
  return issues;
}

if (import.meta.main) {
  const git = Bun.spawn(
    [
      "git",
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "native",
      "apps",
      "packages",
      "tools",
      "tests",
    ],
    { stdout: "pipe" },
  );
  const names = (await new Response(git.stdout).text())
    .split("\0")
    .filter(Boolean);
  if (await git.exited) throw new Error("Unable to enumerate source files");
  const files = new Map<string, string>();
  for (const file of new Set(names)) {
    try {
      if (!/\.[cm]?[jt]sx?$/.test(file)) await stat(file);
      files.set(
        file,
        /\.[cm]?[jt]sx?$/.test(file) ? await readFile(file, "utf8") : "",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const issues = inspectSourceLayout(files);
  for (const issue of issues) console.error(issue.file + ": " + issue.message);
  if (issues.length) process.exitCode = 1;
  else
    console.log(
      "Source layout and relative imports verified (" + files.size + " files)",
    );
}
