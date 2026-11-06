import { expect, test } from "bun:test";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GameNative } from "../src/main/game-native";
import { projectGameDiagnostic } from "../src/shared/game-diagnostics";
import type { GameTunnelConfig } from "@cinegather/contracts";
const transport = (): GameTunnelConfig => ({
  sessionId: crypto.randomUUID(),
  memberId: crypto.randomUUID(),
  clientId: crypto.randomUUID(),
  clientSecret: "a".repeat(43),
  role: "host",
  revision: 1,
  expiresAt: new Date(Date.now() + 25000).toISOString(),
  server: {
    host: "game.example.test",
    port: 17443,
    tlsName: "game.example.test",
    issuer: "https://api.example.test/api/v1/game-tunnel/identity",
    audience: "cinegather-game",
    stunServer: "game.example.test:3478",
  },
  peers: [],
});
async function fixture(code: string) {
  const root = await mkdtemp(join(tmpdir(), "cg-game-native-")),
    binary = join(root, "fixture");
  await writeFile(binary, `#!/usr/bin/env node\n` + code);
  await chmod(binary, 0o700);
  return { root, binary };
}
test("game helper correlates out-of-order replies and closes its process", async () => {
  const { root, binary } = await fixture(
    `let buffer='';let waiting=[];process.stdin.on('data',chunk=>{buffer+=chunk;for(;;){let n=buffer.indexOf('\\n');if(n<0)break;let c=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);if(c.op==='stop'){process.stdout.write(JSON.stringify({id:c.id,ok:true,result:{state:'stopped'}})+'\\n');process.exit(0)}waiting.push(c);if(waiting.length===2){for(const q of waiting.reverse())process.stdout.write(JSON.stringify({id:q.id,ok:true,result:{nonce:q.config.sessionId}})+'\\n');waiting=[]}}});`,
  );
  const events: unknown[] = [];
  const native = new GameNative({
    binaryPath: binary,
    event: (e) => events.push(e),
  });
  try {
    const a = transport(),
      b = transport();
    expect(
      await Promise.all([native.configure(a, []), native.configure(b, [])]),
    ).toEqual([{ nonce: a.sessionId }, { nonce: b.sessionId }]);
    expect(native.running).toBe(true);
    await native.close();
    expect(native.running).toBe(false);
    expect(events.length).toBeGreaterThan(0);
  } finally {
    await native.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("malformed or oversized helper output rejects pending operations and stops the child", async () => {
  for (const output of ["not-json\n", "x".repeat(66000)]) {
    const { root, binary } = await fixture(
      `process.stdin.once('data',()=>process.stdout.write(${JSON.stringify(output)}));`,
    );
    const native = new GameNative({ binaryPath: binary });
    try {
      await expect(native.configure(transport(), [])).rejects.toThrow();
      expect(native.running).toBe(false);
    } finally {
      await native.close();
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("an unresponsive helper that ignores graceful shutdown cannot remain as an orphan", async () => {
  const { root, binary } = await fixture(
    `let b='';process.on('SIGTERM',()=>{});process.stdin.on('data',chunk=>{b+=chunk;for(;;){const n=b.indexOf('\\n');if(n<0)break;const c=JSON.parse(b.slice(0,n));b=b.slice(n+1);if(c.op==='configure'){process.stdout.write(JSON.stringify({id:c.id,ok:true,result:{pid:process.pid}})+'\\n')}}});`,
  );
  const native = new GameNative({ binaryPath: binary });
  try {
    const result = (await native.configure(transport(), [])) as { pid: number };
    await native.close();
    expect(() => process.kill(result.pid, 0)).toThrow();
  } finally {
    await native.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("a rejected configuration records its failure phase without exporting credentials", async () => {
  const { root, binary } = await fixture(
    `process.stdin.once('data',data=>{const c=JSON.parse(String(data));process.stdout.write(JSON.stringify({id:c.id,ok:false,code:'CONFIG_REJECTED'})+'\\n');});`,
  );
  const events: unknown[] = [];
  const native = new GameNative({
    binaryPath: binary,
    event: (e) => events.push(e),
  });
  try {
    await expect(native.configure(transport(), [])).rejects.toThrow(
      "授权已失效或配置不匹配",
    );
    expect(events).toContainEqual({
      event: "transport",
      state: "failed",
      phase: "configuration",
      code: "CONFIG_REJECTED",
    });
    expect(events.map((event) => projectGameDiagnostic(event))).toContainEqual({
      event: "config-rejected",
      code: "CONFIG_REJECTED",
    });
    expect(JSON.stringify(events)).not.toContain("clientSecret");
  } finally {
    await native.close();
    await rm(root, { recursive: true, force: true });
  }
});
