import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";

const languages = ["cpp", "swift", "kotlin", "python", "go", "shell"] as const;
type Language = (typeof languages)[number];
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const check = args.includes("--check");
const requested = args.find((arg) => arg.startsWith("--language="))?.slice(11);
if (requested && !languages.includes(requested as Language))
  throw new Error("Choose --language=" + languages.join("|"));
const git = Bun.spawnSync([
  "git",
  "ls-files",
  "--cached",
  "--others",
  "--exclude-standard",
  "-z",
  "native",
  "apps/mobile/modules",
  "tools",
]);
if (git.exitCode) throw new Error("Unable to enumerate owned source files");
const files = [...new Set(new TextDecoder().decode(git.stdout).split("\0"))]
  .filter(Boolean)
  .filter(
    (file) =>
      !/(?:^|\/)(?:vendor|third_party|node_modules|build|Pods)\//.test(file),
  );
function language(file: string): Language | undefined {
  const suffix = extname(file);
  if ([".cpp", ".hpp", ".h", ".m", ".mm"].includes(suffix)) return "cpp";
  if (suffix === ".swift") return "swift";
  if (suffix === ".kt") return "kotlin";
  if (suffix === ".py") return "python";
  if (suffix === ".go") return "go";
  if (suffix === ".sh") return "shell";
}
function appleTool(name: string, override?: string) {
  if (override) return [override];
  if (Bun.which(name)) return [name];
  return process.platform === "darwin" ? ["xcrun", name] : [name];
}
function command(kind: Language, file: string): string[] {
  switch (kind) {
    case "cpp":
      return [
        ...appleTool("clang-format", process.env.CLANG_FORMAT),
        "--style=file",
        file,
      ];
    case "swift":
      return [
        ...appleTool("swift-format", process.env.SWIFT_FORMAT),
        "format",
        "--configuration",
        ".swift-format",
        file,
      ];
    case "kotlin":
      return [
        ...(process.env.KTFMT_JAR
          ? [process.env.JAVA ?? "java", "-jar", process.env.KTFMT_JAR]
          : ["ktfmt"]),
        "--kotlinlang-style",
        "--do-not-remove-unused-imports",
        "--quiet",
        "--stdin-name=" + file,
        "-",
      ];
    case "python":
      return [
        process.env.RUFF ?? "ruff",
        "format",
        "--quiet",
        "--stdin-filename",
        file,
        "-",
      ];
    case "go":
      return [process.env.GOFMT ?? "gofmt", file];
    case "shell":
      return [process.env.SHFMT ?? "shfmt", "-i", "2", "-ci", file];
  }
}
let inspected = 0,
  changed = 0;
for (const file of files) {
  const kind = language(file);
  if (!kind || (requested && requested !== kind)) continue;
  const before = await readFile(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!before) continue;
  const cmd = command(kind, file);
  const result = Bun.spawnSync(cmd, {
    stdin: before,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `${kind} formatter failed for ${file}. Install the formatter or set its override environment variable.\n${new TextDecoder().decode(result.stderr)}`,
    );
  }
  inspected++;
  if (!before.equals(Buffer.from(result.stdout))) {
    changed++;
    console.log((check ? "Needs formatting: " : "Formatted: ") + file);
    if (!check) await writeFile(file, result.stdout);
  }
}
console.log(
  `Native/script formatting: ${inspected} files checked, ${changed} ${check ? "need changes" : "changed"}`,
);
if (check && changed) process.exitCode = 1;
