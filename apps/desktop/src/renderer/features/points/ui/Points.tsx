import { useEffect, useState } from "react";
import styled from "@emotion/styled";
import { RefreshCw, ScrollText } from "lucide-react";
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
import { PageHeading, PageSurface } from "../../../ui/layout/Page";
import { PointsDetail } from "./PointsDetail";

const Surface = styled(PageSurface)`
  .points-summary .ant-card-body {
    padding: 16px 18px;
  }
  .points-summary-grid {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 20px 32px;
  }
  .points-balance {
    flex: 1 1 220px;
    min-width: 0;
  }
  .points-balance-value {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin: 8px 0;
  }
  .points-balance-value strong {
    font-size: 36px;
    line-height: 44px;
  }
  .points-daily {
    flex: 1 1 280px;
    min-width: 0;
  }
  .points-daily-row,
  .points-history-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px 16px;
  }
  .points-history-heading h2 {
    margin: 0;
    font-size: 16px;
    line-height: 24px;
    font-weight: 600;
  }
  .points-time-filter {
    width: 124px;
  }
`;

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
    <Surface aria-label="我的积分页面">
      <PageHeading>
        <h1>我的积分</h1>
        <Space>
          <Button
            icon={<RefreshCw size={16} />}
            onClick={() => setRevision((n) => n + 1)}
            loading={loading}
          >
            刷新
          </Button>
          <Button
            icon={<ScrollText size={16} />}
            disabled={!policy}
            onClick={() => setRules(policy)}
          >
            积分规则
          </Button>
        </Space>
      </PageHeading>
      {error && <Alert type="error" showIcon title={error} />}
      <Card size="small" className="points-summary">
        <div className="points-summary-grid">
          <div className="points-balance">
            <Typography.Text type="secondary">可用积分</Typography.Text>
            <div className="points-balance-value">
              <strong>{summary?.balance ?? "—"}</strong>
              <Typography.Text type="secondary">积分</Typography.Text>
            </div>
            <Typography.Text type="secondary">
              当前积分来自游戏奖励
            </Typography.Text>
          </div>
          <div className="points-daily">
            <div className="points-daily-row">
              <Typography.Text type="secondary">今日游戏积分</Typography.Text>
              <strong>
                {summary?.todayEarned ?? 0} / {summary?.dailyCap ?? "—"}
              </strong>
            </div>
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
            <div className="points-daily-row">
              <Typography.Text type="secondary">
                {summary?.enabled === false
                  ? "游戏积分发放已暂停"
                  : `今天还可获得 ${summary?.remaining ?? 0} 积分`}
              </Typography.Text>
              <Typography.Text type="secondary">
                每日 00:00 刷新
              </Typography.Text>
            </div>
          </div>
        </div>
      </Card>
      <div className="points-history-heading">
        <h2>积分明细</h2>
        <Space wrap size={12}>
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
            className="points-time-filter"
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
      </div>
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
    </Surface>
  );
}
