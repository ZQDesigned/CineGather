import {
  partyAnswerKey,
  partyWordInput,
  type PartyWordInput,
  type PartyImportInput,
} from "@cinegather/contracts";
// RFC-style quoted cells (including line breaks); reject malformed quoting rather than silently shifting columns.
function csv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
      continue;
    }
    if (c === "," || c === "\n" || c === "\r") {
      row.push(cell);
      cell = "";
      closed = false;
      if (c !== ",") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        if (row.some((v) => v.trim())) rows.push(row);
        row = [];
      }
    } else if (c === '"') {
      if (cell || closed) throw Error("CSV 引号格式错误");
      quoted = true;
    } else {
      if (closed) throw Error("CSV 引号后只能接分隔符");
      cell += c;
    }
  }
  if (quoted) throw Error("CSV 存在未闭合引号");
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}
export function parsePartyImport(input: PartyImportInput) {
  const errors: string[] = [],
    items: PartyWordInput[] = [];
  let raw: unknown[];
  try {
    const content = input.content.replace(/^\uFEFF/, "");
    if (input.format === "json") {
      const value: unknown = JSON.parse(content);
      if (!Array.isArray(value)) throw Error("JSON 顶层必须为数组");
      raw = value;
    } else {
      const rows = csv(content),
        header = rows.shift();
      const hierarchical = header?.[1] === "parentCategory";
      const expected = [
        "answer",
        ...(hierarchical ? ["parentCategory"] : []),
        "category",
        "clue1",
        "clue2",
        "clue3",
        "enabled",
      ];
      const hasModes = header?.at(-1) === "modes";
      if (
        header?.join(",") !==
        [...expected, ...(hasModes ? ["modes"] : [])].join(",")
      )
        throw Error(
          "CSV 表头应为 answer,parentCategory,category,clue1,clue2,clue3,enabled,modes（parentCategory 和 modes 列可省略）",
        );
      raw = rows.map((r) => {
        if (r.length !== expected.length + (hasModes ? 1 : 0)) return null;
        const offset = hierarchical ? 1 : 0;
        return {
          answer: r[0],
          ...(hierarchical && r[1]?.trim() ? { parentCategory: r[1] } : {}),
          category: r[1 + offset],
          clues: r.slice(2 + offset, 5 + offset),
          enabled:
            r[5 + offset] === "true"
              ? true
              : r[5 + offset] === "false"
                ? false
                : r[5 + offset],
          ...(hasModes
            ? {
                modes: r
                  .at(-1)
                  ?.split("|")
                  .map((v) => v.trim()),
              }
            : {}),
        };
      });
    }
    if (raw.length < 1 || raw.length > 500)
      throw Error("每次导入需包含 1–500 道题");
  } catch (e) {
    return { items, errors: [(e as Error).message] };
  }
  const seen = new Set<string>();
  raw.forEach((row, index) => {
    const parsed = partyWordInput.safeParse(row);
    if (!parsed.success) {
      errors.push(
        `第 ${index + 1} 条：答案、分类、三条提示或启用状态格式不正确`,
      );
      return;
    }
    const key = partyAnswerKey(parsed.data.answer);
    if (seen.has(key)) {
      errors.push(
        `第 ${index + 1} 条：答案「${parsed.data.answer}」在文件中重复`,
      );
      return;
    }
    seen.add(key);
    items.push(parsed.data);
  });
  return { items, errors };
}
