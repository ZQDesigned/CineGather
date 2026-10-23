import { randomUUID } from "node:crypto";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  createDatabase,
  users,
  credentials,
  auditLogs,
} from "@cinegather/database";
const [command, argument, ...extra] = process.argv.slice(2);
const parsed = z.uuid().toLowerCase().safeParse(argument);
if (
  !["grant", "revoke"].includes(command ?? "") ||
  !parsed.success ||
  extra.length
) {
  console.error(
    "用法：bun run superadmin:grant <用户ID> 或 bun run superadmin:revoke <用户ID>；生产环境：node apps/api/dist/admin-cli.js grant|revoke <用户ID>",
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
      .where(eq(users.id, parsed.data))
      .for("update");
    if (!target?.username || !target.passwordHash)
      throw new Error("用户 ID 对应的已注册账号不存在");
    if (command === "grant" && target.disabledAt)
      throw new Error("不能向已停用的账号授予超级管理员权限");
    if (command === "revoke" && target.isSuperAdmin && !target.disabledAt) {
      const others = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.isSuperAdmin, true),
            isNull(users.disabledAt),
            isNotNull(users.username),
            isNotNull(users.passwordHash),
          ),
        );
      if (!others.some((u) => u.id !== target.id))
        throw new Error("不能撤销最后一位可用的超级管理员");
    }
    await tx
      .update(users)
      .set({ isSuperAdmin: command === "grant" })
      .where(eq(users.id, target.id));
    if (command === "revoke")
      await tx
        .update(credentials)
        .set({ revokedAt: new Date() })
        .where(eq(credentials.userId, target.id));
    await tx.insert(auditLogs).values({
      id: randomUUID(),
      actorId: null,
      action:
        command === "grant"
          ? "admin.superadmin_granted"
          : "admin.superadmin_revoked",
      targetId: target.id,
      details: { targetName: target.username, reason: "服务端用户 ID 命令" },
    });
  });
  console.log(
    command === "grant"
      ? "已按用户 ID 授予超级管理员权限。"
      : "已撤销超级管理员权限及其登录会话，普通角色保持不变。",
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "超级管理员命令失败");
  process.exitCode = 1;
} finally {
  await pool.end();
}
