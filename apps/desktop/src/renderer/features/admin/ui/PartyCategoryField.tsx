import type { CSSProperties } from "react";
import { Select } from "antd";
import { partyCategoryPath, type PartyCategory } from "@cinegather/contracts";
export function PartyCategoryField({
  categories,
  value,
  onChange,
  allowClear = false,
  style,
}: {
  categories: PartyCategory[];
  value?: string;
  onChange?(value: string | undefined): void;
  allowClear?: boolean;
  style?: CSSProperties;
}) {
  return (
    <Select
      aria-label="题目分类"
      value={value}
      onChange={onChange}
      allowClear={allowClear}
      showSearch
      optionFilterProp="label"
      placeholder="选择一级或二级分类"
      style={{ minWidth: 200, ...style }}
      options={categories
        .filter((c) => !c.parentId)
        .flatMap((root) => [
          root,
          ...categories.filter((c) => c.parentId === root.id),
        ])
        .map((c) => ({
          value: c.id,
          label:
            partyCategoryPath(categories, c.id) +
            (!c.enabled ? "（已停用）" : ""),
        }))}
    />
  );
}
