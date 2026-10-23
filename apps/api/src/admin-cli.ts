import { randomUUID } from "node:crypto";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import {
  createDatabase,
  users,
  credentials,
  auditLogs,
} from "@cinegather/database";
import { usernameInput } from "@cinegather/contracts";
const [command, argument, ...extra] = process.argv.slice(2);
const parsed = usernameInput.safeParse(argument);
if (
  !["grant", "revoke"].includes(command ?? "") ||
  !parsed.success ||
  extra.length
) {
  console.error(
    "用法：bun run admin:grant <已注册用户名>，或 node apps/api/dist/admin-cli.js grant|revoke <已注册用户名>",
  );
  process.exit(1);
}
if (!process.env.DATABASE_URL) throw new Error("请先配置 DATABASE_URL");
const { db, pool } = createDatabase(process.env.DATABASE_URL);
try {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(839215)`);
    const [target] = await tx
      .select()
      .from(users)
      .where(eq(users.username, parsed.data))
      .for("update");
    if (!target?.passwordHash || target.disabledAt)
      throw new Error("找不到可用的已注册账号，请先注册后再授权");
    if (command === "revoke" && target.role === "admin") {
      const others = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.role, "admin"),
            isNull(users.disabledAt),
            isNotNull(users.username),
          ),
        );
      if (!others.some((u) => u.id !== target.id))
        throw new Error("不能撤销最后一位可用管理员");
    }
    await tx
      .update(users)
      .set({ role: command === "grant" ? "admin" : "user" })
      .where(eq(users.id, target.id));
    if (command === "revoke")
      await tx
        .update(credentials)
        .set({ revokedAt: new Date() })
        .where(eq(credentials.userId, target.id));
    await tx.insert(auditLogs).values({
      id: randomUUID(),
      actorId: null,
      action: command === "grant" ? "admin.role_granted" : "admin.role_revoked",
      targetId: target.id,
      details: { targetName: target.username, reason: "本机管理员命令" },
    });
  });
  console.log(
    command === "grant"
      ? "管理员权限已授予，请重新打开管理端。"
      : "管理员权限及登录会话已撤销。",
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "管理员命令失败");
  process.exitCode = 1;
} finally {
  await pool.end();
}
