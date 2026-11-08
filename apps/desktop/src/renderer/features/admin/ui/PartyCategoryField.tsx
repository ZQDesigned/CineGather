import type { CSSProperties } from "react";
import { TreeSelect } from "antd";
import { type PartyCategory } from "@cinegather/contracts";
import {
  partyCategoryTree,
  type PartyCategoryTreeNode,
} from "./party-category-tree";
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
    <TreeSelect<string | undefined, PartyCategoryTreeNode>
      aria-label="题目分类"
      value={value}
      onChange={onChange}
      allowClear={allowClear}
      showSearch={{ treeNodeFilterProp: "path" }}
      treeNodeLabelProp="path"
      treeDefaultExpandAll
      treeLine={{ showLeafIcon: false }}
      placeholder="选择一级或二级分类"
      style={{ minWidth: 200, ...style }}
      treeData={partyCategoryTree(categories)}
    />
  );
}
