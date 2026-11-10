import { bootstrapDesktopUI } from "./features/updates/hot-runtime";
void bootstrapDesktopUI()
  .then(() => import("./ui/layout/entry"))
  .catch(() => {
    const root = document.getElementById("root")!;
    const title = document.createElement("h2");
    title.textContent = "界面暂时无法加载";
    const text = document.createElement("p");
    text.textContent =
      "应用将尝试恢复上一版界面。若持续出现，请重新启动或下载完整安装包。";
    root.replaceChildren(title, text);
  });
