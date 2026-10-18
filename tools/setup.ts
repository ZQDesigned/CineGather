import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const secret = () => randomBytes(32).toString('hex');
mkdirSync('.local', { recursive: true });
if (!existsSync('.env')) {
  const pg = secret();
  const key = `cg_${randomBytes(8).toString('hex')}`;
  const lk = secret();
  writeFileSync('.env', `DATABASE_URL=postgres://cinegather:${pg}@127.0.0.1:55432/cinegather\nPOSTGRES_PASSWORD=${pg}\nLIVEKIT_API_KEY=${key}\nLIVEKIT_API_SECRET=${lk}\nLIVEKIT_URL=ws://127.0.0.1:7880\nLIVEKIT_INTERNAL_URL=http://127.0.0.1:7880\nSESSION_SECRET=${secret()}\nAPI_HOST=127.0.0.1\nAPI_PORT=4310\nCORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173\nVITE_API_URL=http://127.0.0.1:4310\n`, { mode: 0o600 });
}
const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter(l => l && !l.startsWith('#')).map(l => { const n = l.indexOf('='); return [l.slice(0, n), l.slice(n + 1)]; }));
if (!env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) throw new Error('Missing LiveKit secrets in .env');
writeFileSync('.local/livekit.yaml', `port: 7880\nbind_addresses: ["0.0.0.0"]\nrtc:\n  tcp_port: 7881\n  port_range_start: 50000\n  port_range_end: 50100\n  node_ip: 127.0.0.1\n  use_external_ip: false\nkeys:\n  ${env.LIVEKIT_API_KEY}: ${env.LIVEKIT_API_SECRET}\nlogging:\n  level: warn\n`, { mode: 0o600 });
writeFileSync('LICENSE', `MIT License\n\nCopyright (c) 2026 CineGather contributors\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n`);
console.log('Local configuration ready. Secrets are in ignored .env; LICENSE is generated locally.');
