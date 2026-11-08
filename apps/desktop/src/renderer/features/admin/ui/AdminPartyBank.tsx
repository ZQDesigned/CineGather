import { useState } from "react";
import { Tabs } from "antd";
import { hasAdminPermission } from "@cinegather/contracts";
import { useApp } from "../../../store";
import { SubmissionReview } from "../../party-submissions/ui/SubmissionReview";
import { AdminPartyWords } from "./AdminPartyWords";
export function AdminPartyBank({
  revision,
  height,
}: {
  revision: number;
  height: number;
}) {
  const user = useApp((s) => s.user),
    [tab, setTab] = useState("words");
  const tabs = [
    ...(hasAdminPermission(user, "party-words.read")
      ? [{ key: "words", label: "题目管理" }]
      : []),
    ...(hasAdminPermission(user, "party-submissions.read")
      ? [{ key: "submissions", label: "投稿审核" }]
      : []),
  ];
  const active = tabs.some((t) => t.key === tab) ? tab : tabs[0]?.key;
  return (
    <>
      <Tabs activeKey={active} onChange={setTab} items={tabs} />
      {active === "words" ? (
        <AdminPartyWords revision={revision} height={height - 54} />
      ) : active === "submissions" ? (
        <SubmissionReview revision={revision} height={height - 54} />
      ) : null}
    </>
  );
}
