import { partyCategoryPath, type PartyCategory } from "@cinegather/contracts";
export interface PartyCategoryTreeNode {
  key: string;
  value: string;
  title: string;
  path: string;
  category: PartyCategory;
  children?: PartyCategoryTreeNode[];
}
export function partyCategoryTree(
  categories: PartyCategory[],
): PartyCategoryTreeNode[] {
  const node = (category: PartyCategory): PartyCategoryTreeNode => ({
    key: category.id,
    value: category.id,
    title: category.name + (!category.enabled ? "（已停用）" : ""),
    path:
      partyCategoryPath(categories, category.id) +
      (!category.enabled ? "（已停用）" : ""),
    category,
  });
  return categories
    .filter((c) => !c.parentId)
    .map((root) => {
      const children = categories
        .filter((c) => c.parentId === root.id)
        .map(node);
      return { ...node(root), ...(children.length ? { children } : {}) };
    });
}
