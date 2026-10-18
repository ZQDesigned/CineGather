const current = await Bun.$`git ls-files`.text();
const hasHistory = await Bun.$`git rev-parse --verify HEAD`.quiet().nothrow();
const history =
  hasHistory.exitCode === 0
    ? await Bun.$`git log --all --format= --name-only`.text()
    : "";
const forbidden = [
  ...new Set((current + "\n" + history).split("\n").filter(Boolean)),
].filter(
  (p) =>
    /(^|\/)(docs|\.local|\.superpowers)\//i.test(p) ||
    /\.(md|mdx|rst|txt|pdf|docx?|pptx)$/i.test(p) ||
    /(^|\/)(LICENSE|NOTICE|README|CHANGELOG|CONTRIBUTING|AGENTS|SKILL)(\.|$)/i.test(
      p,
    ) ||
    /(^|\/)\.env($|\.(?!example$))/.test(p),
);
if (forbidden.length) {
  console.error(
    "Forbidden documentation or secret paths in Git:",
    forbidden.join(", "),
  );
  process.exit(1);
}
console.log(
  "Git index and complete history contain no documentation or environment secrets.",
);

export {};
