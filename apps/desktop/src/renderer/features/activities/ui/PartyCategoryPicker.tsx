import { useEffect, useState } from "react";
import { Alert, Checkbox, Modal, Space, Typography } from "antd";
import { unwrap } from "@cinegather/api-client";
import {
  partyCategoryBranches,
  partyCategoryStats,
  type ActivitySnapshot,
  type PartyCatalog,
} from "@cinegather/contracts";
import { api, report } from "../../../controller";
import { Button } from "../../rooms/ui/Controls";
import { roomActivities } from "../room-activities";
import { useRetainedDialog } from "../../../ui/useRetainedDialog";
export function PartyCategoryPicker({
  snapshot,
  controlled,
  onAvailability,
}: {
  snapshot: ActivitySnapshot;
  controlled: boolean;
  onAvailability(allowed: boolean): void;
}) {
  const game = snapshot.game!;
  const [catalog, setCatalog] = useState<PartyCatalog>(),
    [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false);
  const [target, setTarget] = useState<{
    catalog: PartyCatalog;
    ids: string[];
    version: number;
    roomId: string;
    generation: number;
    mode: "draw" | "quiz";
    removed: boolean;
  }>();
  const dialog = useRetainedDialog(target);
  const selection = game.categorySelection ?? { categoryIds: null, version: 0 };
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    if (!["lobby", "finished"].includes(game.phase)) return;
    let alive = true;
    setCatalog(undefined);
    void api
      .GET("/api/v1/rooms/{roomId}/activity/categories", {
        params: { path: { roomId: snapshot.roomId } },
      })
      .then(unwrap)
      .then((c) => {
        if (alive) setCatalog(c);
      })
      .catch(report);
    return () => {
      alive = false;
    };
  }, [
    snapshot.roomId,
    snapshot.generation,
    game.kind,
    game.phase,
    selection.version,
  ]);
  const stats = catalog
      ? partyCategoryStats(catalog.categories, selection.categoryIds, game.kind)
      : undefined,
    rule = catalog?.policy[game.kind];
  const allowed =
    !!stats &&
    !!rule &&
    stats.questionCount >= rule.minQuestions &&
    stats.categoryCount >= rule.minCategories;
  useEffect(() => {
    onAvailability(allowed);
  }, [allowed, onAvailability]);
  async function open() {
    setLoading(true);
    try {
      const c = unwrap(
        await api.GET("/api/v1/rooms/{roomId}/activity/categories", {
          params: { path: { roomId: snapshot.roomId } },
        }),
      );
      roomActivities.assertContext(snapshot);
      const chosen = partyCategoryStats(
        c.categories,
        selection.categoryIds,
        game.kind,
      ).categoryIds;
      setIds(chosen);
      setTarget({
        catalog: c,
        ids: chosen,
        version: selection.version,
        roomId: snapshot.roomId,
        generation: snapshot.generation,
        mode: game.kind,
        removed:
          selection.categoryIds !== null &&
          chosen.length !== selection.categoryIds.length,
      });
      setCatalog(c);
    } catch (e) {
      report(e);
    } finally {
      setLoading(false);
    }
  }
  const shown = dialog.value,
    c = shown?.catalog,
    dialogMode = shown?.mode ?? game.kind,
    preview = c ? partyCategoryStats(c.categories, ids, dialogMode) : undefined;
  useEffect(() => {
    if (!["lobby", "finished"].includes(game.phase)) setTarget(undefined);
  }, [game.phase]);
  function toggle(branch: string[], checked: boolean) {
    setIds((old) =>
      checked
        ? [...new Set([...old, ...branch])]
        : old.filter((id) => !branch.includes(id)),
    );
  }
  return (
    <>
      {["lobby", "finished"].includes(game.phase) && (
        <Space wrap>
          <Typography.Text type="secondary">
            {stats
              ? `已选 ${stats.categoryCount} 个分类，共 ${stats.questionCount} 道可用题`
              : "正在读取题库分类…"}
          </Typography.Text>
          {controlled && (
            <Button size="small" loading={loading} onClick={() => void open()}>
              选择分类
            </Button>
          )}
          {stats && rule && !allowed && (
            <Typography.Text type="warning">
              至少需要 {rule.minQuestions} 道题
              {rule.minCategories ? `、${rule.minCategories} 个分类` : ""}
            </Typography.Text>
          )}
        </Space>
      )}
      <Modal
        title="选择题目分类"
        open={dialog.open}
        afterClose={dialog.afterClose}
        onCancel={() => {
          if (!saving) setTarget(undefined);
        }}
        okText="保存选择"
        cancelText="取消"
        confirmLoading={saving}
        okButtonProps={{ disabled: !preview || !shown }}
        onOk={async () => {
          if (!shown || saving) return;
          setSaving(true);
          try {
            roomActivities.assertContext(shown);
            await roomActivities.command(
              {
                type: "party",
                generation: shown.generation,
                action: {
                  type: "categories",
                  categoryIds: ids,
                  selectionVersion: shown.version,
                },
              },
              shown,
            );
            setTarget(undefined);
          } catch (e) {
            report(e);
          } finally {
            setSaving(false);
          }
        }}
        destroyOnHidden
      >
        {c && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {shown?.removed && (
              <Alert
                type="info"
                title="部分分类已停用、移除或没有当前玩法的题目，已取消选中，请确认后保存。"
              />
            )}
            <Typography.Text>
              {preview?.categoryCount} 个分类，{preview?.questionCount} 道可用题
            </Typography.Text>
            <Space>
              <Button
                size="small"
                disabled={saving}
                onClick={() =>
                  setIds(
                    partyCategoryStats(c.categories, null, dialogMode)
                      .categoryIds,
                  )
                }
              >
                全选
              </Button>
              <Button size="small" disabled={saving} onClick={() => setIds([])}>
                清空选择
              </Button>
            </Space>
            {preview &&
              (preview.questionCount < c.policy[dialogMode].minQuestions ||
                preview.categoryCount < c.policy[dialogMode].minCategories) && (
                <Alert
                  type="warning"
                  title={`至少需要 ${c.policy[dialogMode].minQuestions} 道题${c.policy[dialogMode].minCategories ? `、${c.policy[dialogMode].minCategories} 个分类` : ""}`}
                />
              )}
            <div
              style={{
                maxHeight: "45vh",
                overflowY: "auto",
                display: "grid",
                gap: 16,
              }}
            >
              {c.categories
                .filter((root) => !root.parentId)
                .map((root) => {
                  const branch = partyCategoryStats(
                    c.categories,
                    partyCategoryBranches(c.categories, root.id),
                    dialogMode,
                  );
                  const selected = branch.categoryIds.filter((id) =>
                    ids.includes(id),
                  ).length;
                  const children = c.categories.filter(
                    (child) => child.parentId === root.id,
                  );
                  return (
                    <div key={root.id}>
                      <Checkbox
                        disabled={saving || !branch.questionCount}
                        checked={
                          !!selected && selected === branch.categoryIds.length
                        }
                        indeterminate={
                          !!selected && selected < branch.categoryIds.length
                        }
                        onChange={(e) =>
                          toggle(branch.categoryIds, e.target.checked)
                        }
                      >
                        <strong>{root.name}</strong>（{branch.questionCount}{" "}
                        题）
                      </Checkbox>
                      {children.length > 0 && (
                        <div
                          style={{
                            paddingLeft: 24,
                            marginTop: 8,
                            display: "flex",
                            gap: 12,
                            flexWrap: "wrap",
                          }}
                        >
                          {[root, ...children].map((item) => {
                            const itemStats = partyCategoryStats(
                              c.categories,
                              [item.id],
                              dialogMode,
                            );
                            if (item.id === root.id && !itemStats.questionCount)
                              return null;
                            return (
                              <Checkbox
                                key={item.id}
                                disabled={saving || !itemStats.questionCount}
                                checked={ids.includes(item.id)}
                                onChange={(e) =>
                                  toggle([item.id], e.target.checked)
                                }
                              >
                                {item.id === root.id ? "本类题目" : item.name}（
                                {itemStats.questionCount} 题）
                              </Checkbox>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
