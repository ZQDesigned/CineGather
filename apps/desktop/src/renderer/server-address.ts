export function serverOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("请输入有效的 API HTTP(S) 地址");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error(
      "请输入有效的 API HTTP(S) 地址，不包含路径、账号或查询参数",
    );
  return url.origin;
}

export async function verifyServer(
  origin: string,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(`${origin}/api/v1/health`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok) throw new Error(`服务器返回 HTTP ${response.status}`);
  const body = await response.json();
  if (
    body?.ok !== true ||
    body.database !== "up" ||
    body.media !== "up" ||
    typeof body.version !== "string"
  )
    throw new Error("该地址未返回有效的映聚健康状态");
}
