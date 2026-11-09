import { useEffect, useState } from "react";
import {
  Alert,
  App,
  Button,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Typography,
} from "antd";
import type {
  PointsPolicy,
  PointsRules,
  AdminPointsEntry,
  PointsGame,
} from "@cinegather/contracts";
import { hasAdminPermission, pointsPolicyInput } from "@cinegather/contracts";
import { pointsGameName, pointsReason } from "@cinegather/client-core";
import { unwrap } from "@cinegather/api-client";
import { api } from "../../../controller";
import { useApp } from "../../../store";
import { useRetainedDialog } from "../../../ui/useRetainedDialog";
import { PointsDetail } from "../../points/ui/PointsDetail";
export function AdminPoints({ revision }: { revision: number }) {
  const user = useApp((s) => s.user),
    canManage = hasAdminPermission(user, "points.manage"),
    { message } = App.useApp();
  const [tab, setTab] = useState("rules"),
    [policy, setPolicy] = useState<PointsPolicy>(),
    [draft, setDraft] = useState<PointsRules>(),
    [game, setGame] = useState<PointsGame>("party.draw"),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [refresh, setRefresh] = useState(0),
    [page, setPage] = useState(1),
    [q, setQ] = useState(""),
    [entries, setEntries] = useState<AdminPointsEntry[]>([]),
    [history, setHistory] = useState<PointsPolicy[]>([]),
    [total, setTotal] = useState(0),
    [detail, setDetail] = useState<AdminPointsEntry>(),
    [change, setChange] = useState<PointsPolicy>();
  const retained = useRetainedDialog(change),
    shown = retained.value;
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError(undefined);
    const run = async () => {
      if (tab === "rules") {
        const p = unwrap(await api.GET("/api/v1/admin/points/rules"));
        if (active) {
          setPolicy(p);
          setDraft({
            enabled: p.enabled,
            dailyCap: p.dailyCap,
            games: p.games,
          });
          setReason("");
        }
      } else if (tab === "ledger") {
        const r = unwrap(
          await api.GET("/api/v1/admin/points/ledger", {
            params: { query: { page, pageSize: 20, q } },
          }),
        );
        if (active) {
          setEntries(r.items);
          setTotal(r.total);
        }
      } else {
        const r = unwrap(
          await api.GET("/api/v1/admin/points/policies", {
            params: { query: { page } },
          }),
        );
        if (active) {
          setHistory(r.items);
          setTotal(r.total);
        }
      }
    };
    void run()
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : "无法加载积分管理");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [tab, page, q, revision, refresh]);
  const changed =
    !!policy &&
    !!draft &&
    JSON.stringify(draft) !==
      JSON.stringify({
        enabled: policy.enabled,
        dailyCap: policy.dailyCap,
        games: policy.games,
      });
  const save = async () => {
    if (!draft || !policy) return;
    const input = pointsPolicyInput.safeParse({
      ...draft,
      version: policy.version,
      reason,
    });
    if (!input.success) {
      setError(
        "请填写调整原因，并确保首次奖励为非负偶数、其他数值在允许范围内。",
      );
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const p = unwrap(
        await api.POST("/api/v1/admin/points/rules", { body: input.data }),
      );
      setPolicy(p);
      setDraft({ enabled: p.enabled, dailyCap: p.dailyCap, games: p.games });
      setReason("");
      void message.success("积分规则已保存");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      style={{ height: "100%", overflow: "auto", paddingBottom: 24 }}
      aria-label="积分管理"
    >
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Tabs
          activeKey={tab}
          onChange={(key) => {
            setTab(key);
            setPage(1);
            setQ("");
          }}
          items={[
            { key: "rules", label: "积分规则" },
            { key: "ledger", label: "积分流水" },
            { key: "history", label: "规则变更记录" },
          ]}
        />
        <Button onClick={() => setRefresh((n) => n + 1)} loading={busy}>
          刷新
        </Button>
      </Space>
      {error && (
        <Alert
          type="error"
          showIcon
          title={error}
          style={{ marginBottom: 16 }}
        />
      )}
      {tab === "rules" && draft && policy ? (
        <Form
          layout="horizontal"
          labelCol={{ flex: "240px" }}
          wrapperCol={{ flex: 1 }}
          style={{ maxWidth: 760, padding: 24 }}
        >
          <Typography.Title level={4} style={{ marginBottom: 28 }}>
            游戏积分规则{" "}
            <Typography.Text type="secondary">
              v{policy.version}
            </Typography.Text>
          </Typography.Title>
          <Form.Item label="开启游戏积分">
            <Switch
              aria-label="开启游戏积分"
              checked={draft.enabled}
              disabled={!canManage || busy}
              onChange={(enabled) => setDraft({ ...draft, enabled })}
            />
          </Form.Item>
          <Form.Item label="每日积分总上限">
            <InputNumber
              aria-label="每日积分总上限"
              min={0}
              max={100000}
              precision={0}
              value={draft.dailyCap}
              disabled={!canManage || busy}
              onChange={(n) => {
                if (n !== null) setDraft({ ...draft, dailyCap: n });
              }}
            />{" "}
            <Typography.Text type="secondary">
              北京时间每日 00:00 刷新
            </Typography.Text>
          </Form.Item>
          <Form.Item label="游戏">
            <Select
              aria-label="积分规则游戏"
              value={game}
              style={{ width: 220 }}
              onChange={setGame}
              options={[
                { value: "party.draw", label: "你画我猜" },
                { value: "party.quiz", label: "猜词抢答" },
              ]}
            />
          </Form.Item>
          <Form.Item label="首次提交猜中奖励">
            <InputNumber
              aria-label="首次提交猜中奖励"
              min={0}
              max={1000}
              step={2}
              precision={0}
              value={draft.games[game].firstCorrect}
              disabled={!canManage || busy}
              onChange={(n) => {
                if (n !== null)
                  setDraft({
                    ...draft,
                    games: {
                      ...draft.games,
                      [game]: { ...draft.games[game], firstCorrect: n },
                    },
                  });
              }}
            />{" "}
            积分
          </Form.Item>
          <Form.Item label="第二次提交猜中奖励">
            <Typography.Text>
              {draft.games[game].firstCorrect / 2} 积分
            </Typography.Text>
            <Typography.Text type="secondary" style={{ marginLeft: 16 }}>
              第三次及以后不发放
            </Typography.Text>
          </Form.Item>
          {game === "party.draw" && (
            <Form.Item label="画手有效参与奖励">
              <InputNumber
                aria-label="画手有效参与奖励"
                min={0}
                max={1000}
                precision={0}
                value={draft.games["party.draw"].painter}
                disabled={!canManage || busy}
                onChange={(n) => {
                  if (n !== null)
                    setDraft({
                      ...draft,
                      games: {
                        ...draft.games,
                        "party.draw": {
                          ...draft.games["party.draw"],
                          painter: n,
                        },
                      },
                    });
                }}
              />{" "}
              积分
            </Form.Item>
          )}
          <Form.Item label="调整原因" required>
            <Input.TextArea
              aria-label="积分规则调整原因"
              value={reason}
              maxLength={300}
              rows={3}
              disabled={!canManage || busy}
              onChange={(e) => setReason(e.target.value)}
            />
          </Form.Item>
          <Typography.Paragraph type="secondary">
            已到账积分保持不变。奖励分值从下一轮生效；日上限和停止发放立即生效。
          </Typography.Paragraph>
          {canManage && (
            <Button
              type="primary"
              onClick={() => void save()}
              loading={busy}
              disabled={!changed}
            >
              保存规则
            </Button>
          )}
        </Form>
      ) : tab === "ledger" ? (
        <>
          <Input.Search
            aria-label="搜索积分流水"
            placeholder="搜索用户名、昵称或流水号"
            allowClear
            maxLength={100}
            onSearch={(value) => {
              setQ(value);
              setPage(1);
            }}
            style={{ maxWidth: 360, margin: "12px 0 20px" }}
          />
          <Table<AdminPointsEntry>
            loading={busy}
            rowKey="id"
            dataSource={entries}
            scroll={{ x: 880 }}
            pagination={{
              current: page,
              pageSize: 20,
              total,
              onChange: setPage,
              showSizeChanger: false,
            }}
            columns={[
              {
                title: "用户",
                key: "user",
                render: (_, e) => (
                  <Space orientation="vertical" size={0}>
                    <strong>{e.displayName}</strong>
                    <Typography.Text type="secondary">
                      {e.username ?? "已注销"}
                    </Typography.Text>
                  </Space>
                ),
              },
              {
                title: "来源",
                key: "source",
                render: (_, e) => (
                  <Space orientation="vertical" size={0}>
                    <span>{pointsGameName(e.game)}</span>
                    <Typography.Text type="secondary">
                      {pointsReason(e)}
                    </Typography.Text>
                  </Space>
                ),
              },
              {
                title: "应发 / 实发",
                key: "amount",
                render: (_, e) => `${e.expected} / ${e.amount}`,
              },
              { title: "余额", dataIndex: "after" },
              {
                title: "时间",
                key: "time",
                render: (_, e) => new Date(e.createdAt).toLocaleString(),
              },
              {
                key: "detail",
                render: (_, e) => (
                  <Button type="link" onClick={() => setDetail(e)}>
                    详情
                  </Button>
                ),
              },
            ]}
          />
        </>
      ) : tab === "history" ? (
        <Table<PointsPolicy>
          rowKey="version"
          loading={busy}
          dataSource={history}
          pagination={{
            current: page,
            pageSize: 20,
            total,
            onChange: setPage,
            showSizeChanger: false,
          }}
          columns={[
            { title: "规则版本", dataIndex: "version" },
            {
              title: "操作人",
              key: "actor",
              render: (_, r) =>
                r.actorUsername
                  ? `${r.actorName}（${r.actorUsername}）`
                  : r.actorName,
            },
            { title: "调整原因", dataIndex: "reason" },
            {
              title: "时间",
              key: "time",
              render: (_, r) => new Date(r.createdAt).toLocaleString(),
            },
            {
              key: "detail",
              render: (_, r) => (
                <Button type="link" onClick={() => setChange(r)}>
                  查看
                </Button>
              ),
            },
          ]}
        />
      ) : null}
      <PointsDetail entry={detail} onClose={() => setDetail(undefined)} />
      <Modal
        title={`积分规则 v${shown?.version ?? ""}`}
        open={retained.open}
        onCancel={() => setChange(undefined)}
        afterClose={retained.afterClose}
        footer={<Button onClick={() => setChange(undefined)}>关闭</Button>}
      >
        {shown && (
          <Descriptions
            column={1}
            items={[
              {
                key: "actor",
                label: "操作人",
                children: shown.actorUsername
                  ? `${shown.actorName}（${shown.actorUsername}）`
                  : shown.actorName,
              },
              { key: "reason", label: "调整原因", children: shown.reason },
              {
                key: "enabled",
                label: "发放状态",
                children: shown.enabled ? "开启" : "关闭",
              },
              { key: "cap", label: "每日总上限", children: shown.dailyCap },
              ...Object.entries(shown.games).map(([key, value]) => ({
                key,
                label: pointsGameName(key),
                children: `首次 ${value.firstCorrect}，第二次 ${value.firstCorrect / 2}${key === "party.draw" ? `，画手 ${value.painter}` : ""}`,
              })),
            ]}
          />
        )}
      </Modal>
    </div>
  );
}
