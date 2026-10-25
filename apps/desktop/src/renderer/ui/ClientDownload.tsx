import { useEffect, useState } from "react";
import { Alert, Button, Card, Flex, Spin, Tag, Typography } from "antd";
import { AppleFilled, WindowsFilled } from "@ant-design/icons";
import styled from "@emotion/styled";
import { Download } from "lucide-react";
import { clientUpdateOrigin, clientVersionSchema } from "@cinegather/contracts";
import { ModalShell } from "./Modal";

const DownloadLayout = styled.div`
  .download-version {
    margin-bottom: 20px;
  }
  .download-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
  }
  .ant-card-body {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 28px 12px 20px;
  }
  .recommended-download {
    border-color: #b39bff80;
    background: #b39bff0a;
  }
  .system-icon {
    display: grid;
    place-items: center;
    height: 56px;
    color: var(--accent);
    font-size: 44px;
  }
  .download-title {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 28px;
    white-space: nowrap;
  }
  .download-title .ant-tag {
    margin: 0;
  }
  .download-error {
    margin-top: 16px;
  }
`;

export function ClientDownload() {
  const [latest, setLatest] = useState<string>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    setLatest(undefined);
    void (async () => {
      try {
        const response = await fetch("/downloads/windows-latest.json", {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(8000),
          ]),
        });
        if (!response.ok) throw new Error("Download metadata unavailable");
        const metadata = await response.json();
        const version = clientVersionSchema.parse(metadata.version);
        if (!controller.signal.aborted) setLatest(version);
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    })();
    return () => controller.abort();
  }, [attempt]);
  const releases = [
    {
      label: "Windows 安装版",
      detail: "x64",
      file: "win-x64-setup.exe",
      icon: <WindowsFilled />,
      recommended: true,
    },
    {
      label: "Windows 便携版",
      detail: "x64",
      file: "win-x64-portable.exe",
      icon: <WindowsFilled />,
    },
    {
      label: "macOS",
      detail: "Apple Silicon",
      file: "mac-arm64.dmg",
      icon: <AppleFilled />,
    },
  ];
  return (
    <ModalShell title="下载客户端" wide>
      <DownloadLayout>
        <Flex align="center" gap={8} className="download-version">
          <Typography.Text type="secondary">最新版本</Typography.Text>
          {latest ? (
            <Tag color="purple">v{latest}</Tag>
          ) : error ? (
            <Typography.Text type="secondary">暂不可用</Typography.Text>
          ) : (
            <Spin size="small" aria-label="正在获取最新版本" />
          )}
        </Flex>
        <div className="download-grid">
          {releases.map(({ label, detail, file, icon, recommended }) => (
            <Card
              key={file}
              className={recommended ? "recommended-download" : undefined}
            >
              <span className="system-icon" aria-hidden="true">
                {icon}
              </span>
              <div className="download-title">
                <Typography.Text strong>{label}</Typography.Text>
                {recommended && <Tag color="purple">推荐</Tag>}
              </div>
              <Typography.Text type="secondary">{detail}</Typography.Text>
              <Button
                block
                type={recommended ? "primary" : "default"}
                icon={<Download size={16} />}
                aria-label={`下载${label}`}
                disabled={!latest}
                href={
                  latest
                    ? `${clientUpdateOrigin}/downloads/CineGather-${latest}-${file}`
                    : undefined
                }
                target="_blank"
                rel="noopener noreferrer"
              >
                下载
              </Button>
            </Card>
          ))}
        </div>
        {error && (
          <Alert
            className="download-error"
            type="warning"
            showIcon
            title="暂时无法获取最新版本，请重试。"
            action={
              <Button
                size="small"
                onClick={() => setAttempt((value) => value + 1)}
              >
                重试
              </Button>
            }
          />
        )}
      </DownloadLayout>
    </ModalShell>
  );
}
