export function trustedURL(raw: string, devURL?: string) {
  try { const url = new URL(raw); if (url.protocol === 'app:' && url.hostname === 'cinegather' && !url.username && !url.password) return true; return Boolean(devURL && url.origin === new URL(devURL).origin); }
  catch { return false; }
}
export function allowedExternal(raw: string) {
  try { const url = new URL(raw); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}
