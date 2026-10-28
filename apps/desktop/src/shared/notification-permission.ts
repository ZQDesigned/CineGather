export function shouldFallbackNotification(
  platform: string,
  signed: boolean,
  error: string,
) {
  // Unsigned macOS bundles cannot use UNNotification; that is a packaging
  // compatibility failure, even though macOS reports its permission error code.
  if (platform === "darwin" && !signed) return true;
  if (
    /denied|permission|not allowed|disabled|拒绝|权限|禁用|不允许|80070005|-2147024891/i.test(
      error,
    )
  )
    return false;
  if (
    platform === "darwin" &&
    /UNErrorDomain.*(?:错误|error|Code)[\s=:]*1(?:\D|$)/i.test(error)
  )
    return false;
  return true;
}
