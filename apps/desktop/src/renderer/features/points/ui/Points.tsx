import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Empty,
  Modal,
  Progress,
  Segmented,
  Select,
  Space,
  Table,
  Typography,
} from "antd";
import type {
  PointsEntry,
  PointsSummary,
  PublicPointsPolicy,
} from "@cinegather/contracts";
import { pointsGameName, pointsReason } from "@cinegather/client-core";
import { unwrap } from "@cinegather/api-client";
import { api } from "../../../controller";
import { useRetainedDialog } from "../../../ui/useRetainedDialog";
import { PointsDetail } from "./PointsDetail";
export function Points() {
  const [summary, setSummary] = useState<PointsSummary>(),
    [policy, setPolicy] = useState<PublicPointsPolicy>(),
    [items, setItems] = useState<PointsEntry[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [game, setGame] = useState("all"),
    [today, setToday] = useState("false"),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<string>(),
    [detail, setDetail] = useState<PointsEntry>(),
    [rules, setRules] = useState<PublicPointsPolicy>();
  const ruleDialog = useRetainedDialog(rules),
    shownRules = ruleDialog.value;
  useEffect(() => {
    const refresh = () => setRevision((n) => n + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    void Promise.all([
      api.GET("/api/v1/points").then(unwrap),
      api.GET("/api/v1/points/rules").then(unwrap),
      api
        .GET("/api/v1/points/ledger", {
          params: {
            query: {
              page,
              pageSize: 20,
              ...(game === "all" ? {} : { game }),
              today,
            },
          },
        })
        .then(unwrap),
    ])
      .then(([s, p, list]) => {
        if (active) {
          setSummary(s);
          setPolicy(p);
          setItems(list.items);
          setTotal(list.total);
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "无法读取积分");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, game, today, revision]);
  return (
    <section
      aria-label="我的积分页面"
      style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 28 }}
    >
      <Space
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 24,
        }}
      >
        <Typography.Title level={3} style={{ margin: 0 }}>
          我的积分
        </Typography.Title>
        <Space>
          <Button onClick={() => setRevision((n) => n + 1)} loading={loading}>
            刷新
          </Button>
          <Button disabled={!policy} onClick={() => setRules(policy)}>
            积分规则
          </Button>
        </Space>
      </Space>
      {error && (
        <Alert
          type="error"
          showIcon
          title={error}
          style={{ marginBottom: 16 }}
        />
      )}
      <Card style={{ marginBottom: 28 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 40,
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: "1 1 220px" }}>
            <Typography.Text type="secondary">可用积分</Typography.Text>
            <Typography.Title style={{ margin: "12px 0", fontSize: 44 }}>
              {summary?.balance ?? "—"}
              <small style={{ fontSize: 13, fontWeight: 400, marginLeft: 12 }}>
                积分
              </small>
            </Typography.Title>
            <Typography.Text type="secondary">
              当前积分来自游戏奖励
            </Typography.Text>
          </div>
          <div style={{ flex: "1 1 280px" }}>
            <Space style={{ width: "100%", justifyContent: "space-between" }}>
              <Typography.Text type="secondary">今日游戏积分</Typography.Text>
              <strong>
                {summary?.todayEarned ?? 0} / {summary?.dailyCap ?? "—"}
              </strong>
            </Space>
            <Progress
              percent={
                summary?.dailyCap
                  ? Math.min(
                      100,
                      (100 * summary.todayEarned) / summary.dailyCap,
                    )
                  : 0
              }
              showInfo={false}
            />
            <Space style={{ width: "100%", justifyContent: "space-between" }}>
              <Typography.Text type="secondary">
                {summary?.enabled === false
                  ? "游戏积分发放已暂停"
                  : `今天还可获得 ${summary?.remaining ?? 0} 积分`}
              </Typography.Text>
              <Typography.Text type="secondary">
                每日 00:00 刷新
              </Typography.Text>
            </Space>
          </div>
        </div>
      </Card>
      <Space
        wrap
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <Typography.Title level={5} style={{ margin: 0 }}>
          积分明细
        </Typography.Title>
        <Space wrap>
          <Segmented
            value={game}
            onChange={(v) => {
              setGame(v);
              setPage(1);
            }}
            options={[
              { value: "all", label: "全部" },
              { value: "party.draw", label: "你画我猜" },
              { value: "party.quiz", label: "猜词抢答" },
            ]}
          />
          <Select
            aria-label="明细时间"
            value={today}
            onChange={(v) => {
              setToday(v);
              setPage(1);
            }}
            options={[
              { value: "false", label: "全部时间" },
              { value: "true", label: "今天" },
            ]}
          />
        </Space>
      </Space>
      <Table<PointsEntry>
        rowKey="id"
        dataSource={items}
        loading={loading}
        scroll={{ x: 600 }}
        locale={{ emptyText: <Empty description="还没有积分记录" /> }}
        pagination={{
          current: page,
          pageSize: 20,
          total,
          onChange: setPage,
          showSizeChanger: false,
        }}
        columns={[
          {
            title: "积分来源",
            key: "source",
            render: (_, e) => (
              <Space orientation="vertical" size={2}>
                <strong>{pointsGameName(e.game)}</strong>
                <Typography.Text type="secondary">
                  {pointsReason(e)}
                </Typography.Text>
              </Space>
            ),
          },
          {
            title: "积分变动",
            key: "amount",
            render: (_, e) => (
              <Typography.Text style={{ color: "#a4d4b5" }}>
                +{e.amount}
              </Typography.Text>
            ),
          },
          { title: "结算后余额", dataIndex: "after", key: "after" },
          {
            title: "时间",
            key: "time",
            render: (_, e) => new Date(e.createdAt).toLocaleString(),
          },
          {
            key: "detail",
            width: 80,
            render: (_, e) => (
              <Button type="link" onClick={() => setDetail(e)}>
                详情
              </Button>
            ),
          },
        ]}
      />
      <PointsDetail entry={detail} onClose={() => setDetail(undefined)} />
      <Modal
        title="积分获取规则"
        open={ruleDialog.open}
        onCancel={() => setRules(undefined)}
        afterClose={ruleDialog.afterClose}
        footer={<Button onClick={() => setRules(undefined)}>知道了</Button>}
      >
        {shownRules && (
          <>
            <Typography.Paragraph>
              每天最多获得 {shownRules.dailyCap} 积分，两种玩法共用额度。
            </Typography.Paragraph>
            {Object.entries(shownRules.games).map(([key, value]) => (
              <div key={key} style={{ marginBottom: 20 }}>
                <Typography.Title level={5}>
                  {pointsGameName(key)}
                </Typography.Title>
                <p>
                  本轮第 1 次提交即猜中 +{value.firstCorrect}，第 2 次 +
                  {value.firstCorrect / 2}；第 3 次及以后不发放积分。
                </p>
                {key === "party.draw" && (
                  <p>画手有实际绘画并正常完成本轮 +{value.painter}。</p>
                )}
              </div>
            ))}
            <Typography.Text type="secondary">
              同一题跨轮次可重复获分。每日额度按北京时间 00:00
              刷新，积分余额保留。达到上限不影响继续游戏和投稿资格统计。
            </Typography.Text>
          </>
        )}
      </Modal>
    </section>
  );
}
