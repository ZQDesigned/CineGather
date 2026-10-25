import { Button, Flex } from "antd";
import { Download } from "lucide-react";
import { clientUpdateOrigin } from "@cinegather/contracts";
import { version } from "../../../package.json";
import { ModalShell } from "./Modal";

export function ClientDownload() {
  const releases = [
    { label: "Windows 安装版", file: "win-x64-setup.exe" },
    { label: "Windows 便携版", file: "win-x64-portable.exe" },
    { label: "macOS（Apple Silicon）", file: "mac-arm64.dmg" },
  ];
  return (
    <ModalShell title="下载客户端">
      <Flex vertical gap={12}>
        {releases.map(({ label, file }) => (
          <Button
            key={file}
            size="large"
            icon={<Download size={18} />}
            href={`${clientUpdateOrigin}/downloads/CineGather-${version}-${file}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {label}
          </Button>
        ))}
      </Flex>
    </ModalShell>
  );
}
