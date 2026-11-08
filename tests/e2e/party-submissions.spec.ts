import { test, expect } from "@playwright/test";
import { retainedClose } from "./helpers/retained-motion";
import { execFileSync } from "node:child_process";
test.use({ actionTimeout: 10000 });
const api = "http://127.0.0.1:14310/api/v1";
test("qualified users submit and withdraw; a dedicated reviewer edits and approves with original attribution", async ({
  page,
  browser,
}) => {
  const suffix = crypto.randomUUID().slice(0, 8),
    password = "Submission fixture 123!";
  async function register(label: string) {
    const response = await page.request.post(api + "/accounts/register", {
      data: {
        username: `submitui_${label}_${suffix}`,
        displayName: label === "author" ? "投稿体验者" : "题目审核员",
        password,
      },
    });
    expect(response.ok()).toBeTruthy();
    return await response.json();
  }
  const author = await register("author"),
    reviewer = await register("reviewer");
  const roleId = crypto.randomUUID();
  const fixture = `import {db} from './apps/api/src/core/context'; import {users,partyFirstCorrect,adminRoles,userRoles} from '@cinegather/database'; import {eq} from 'drizzle-orm'; await db.update(users).set({createdAt:new Date(Date.now()-8*86400000)}).where(eq(users.id,process.env.AUTHOR!)); await db.insert(partyFirstCorrect).values(Array.from({length:50},(_,i)=>({userId:process.env.AUTHOR!,answerKey:'ui资格'+i}))); await db.insert(adminRoles).values({id:process.env.ROLE!,name:'投稿体验'+process.env.ROLE,permissions:['party-submissions.read','party-submissions.review']}); await db.insert(userRoles).values({userId:process.env.REVIEWER!,roleId:process.env.ROLE!}); process.exit(0);`;
  execFileSync("bun", ["-e", fixture], {
    env: {
      ...process.env,
      AUTHOR: author.user.id,
      REVIEWER: reviewer.user.id,
      ROLE: roleId,
    },
    stdio: "pipe",
  });
  const reviewerContext = await browser.newContext(),
    reviewPage = await reviewerContext.newPage();
  async function login(target: typeof page, username: string, path: string) {
    await target.goto(path);
    await target.getByLabel("用户名", { exact: true }).fill(username);
    await target.getByLabel("密码", { exact: true }).fill(password);
    await target.getByRole("button", { name: "登录映聚", exact: true }).click();
  }
  let resumeReview = () => {};
  try {
    await login(page, author.user.username, "/#/submissions");
    await expect(
      page.getByRole("heading", { name: "题目投稿", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("50 / 50", { exact: true })).toBeVisible();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await reviewPage.emulateMedia({ reducedMotion: "no-preference" });
    const trigger = page.getByRole("button", { name: "提交题目", exact: true });
    await page.screenshot({
      path: ".local/question-submissions/user-page.png",
    });
    for (const method of ["cancel", "icon", "escape", "mask"]) {
      await trigger.click();
      const closing = page.getByRole("dialog", {
        name: "提交题目",
        exact: true,
      });
      await closing.getByLabel("答案", { exact: true }).fill("退出保留的草稿");
      await retainedClose(page, closing, () =>
        method === "cancel"
          ? closing.getByRole("button", { name: "取消", exact: true }).click()
          : method === "icon"
            ? closing.locator(".ant-modal-close").click()
            : method === "escape"
              ? page.keyboard.press("Escape")
              : page
                  .locator(".ant-modal-wrap")
                  .click({ position: { x: 5, y: 5 } }),
      );
      await expect(trigger).toBeFocused();
    }
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "提交题目", exact: true });
    await dialog.getByLabel("答案", { exact: true }).fill("投稿体验" + suffix);
    await dialog
      .getByRole("combobox", { name: "题目分类", exact: true })
      .click();
    await page.getByRole("tree").getByText("用品", { exact: true }).click();
    for (let i = 1; i <= 3; i++)
      await dialog
        .getByLabel(`提示 ${i}`, { exact: true })
        .fill(`体验提示第${i}条`);
    await page.screenshot({ path: ".local/question-submissions/editor.png" });
    await retainedClose(page, dialog, () =>
      dialog.getByRole("button", { name: "提交审核", exact: true }).click(),
    );
    await expect(dialog).not.toBeVisible();
    const row = page.getByRole("row").filter({ hasText: "投稿体验" + suffix });
    await expect(row).toContainText("待审核");
    await row.getByRole("button", { name: "查看", exact: true }).click();
    const detail = page.getByRole("dialog", { name: "投稿详情", exact: true });
    for (const method of ["footer", "icon", "escape", "mask"]) {
      await retainedClose(page, detail, () =>
        method === "footer"
          ? detail
              .locator(".ant-modal-footer")
              .getByRole("button", { name: "关闭", exact: true })
              .click()
          : method === "icon"
            ? detail.locator(".ant-modal-close").click()
            : method === "escape"
              ? page.keyboard.press("Escape")
              : page
                  .locator(".ant-modal-wrap")
                  .click({ position: { x: 5, y: 5 } }),
      );
      await expect(
        row.getByRole("button", { name: "查看", exact: true }),
      ).toBeFocused();
      await row.getByRole("button", { name: "查看", exact: true }).click();
    }
    await detail.getByRole("button", { name: "撤回投稿", exact: true }).click();
    await expect(detail).toContainText("已撤回");
    await detail
      .getByRole("button", { name: "修改后提交", exact: true })
      .click();
    const edit = page.getByRole("dialog", { name: "修改投稿", exact: true });
    await retainedClose(page, edit, () =>
      edit.getByRole("button", { name: "提交审核", exact: true }).click(),
    );
    await expect(edit).not.toBeVisible();
    await login(reviewPage, reviewer.user.username, "/#/admin");
    await expect(
      reviewPage.getByRole("tab", { name: "投稿审核", exact: true }),
    ).toBeVisible();
    await expect(
      reviewPage.getByRole("tab", { name: "题目管理", exact: true }),
    ).toHaveCount(0);
    await reviewPage
      .getByRole("menuitem", { name: "题目投稿", exact: true })
      .click();
    await expect(reviewPage.getByText("0 / 50", { exact: true })).toBeVisible();
    await expect(
      reviewPage.getByRole("button", { name: "提交题目", exact: true }),
    ).toBeDisabled();
    await reviewPage
      .getByRole("menuitem", { name: "管理后台", exact: true })
      .click();
    const reviewRow = reviewPage
      .getByRole("row")
      .filter({ hasText: "投稿体验" + suffix });
    await expect(reviewRow).toContainText(
      `投稿体验者（${author.user.username}）`,
    );
    let held = false;
    const gate = new Promise<void>((resolve) => {
      resumeReview = resolve;
    });
    await reviewPage.route(
      "**/api/v1/admin/party-submissions/*",
      async (route) => {
        if (route.request().method() === "GET" && !held) {
          held = true;
          const response = await route.fetch();
          await gate;
          await route.fulfill({ response });
        } else await route.continue();
      },
    );
    await reviewRow.getByRole("button", { name: "审核", exact: true }).click();
    const drawer = reviewPage.getByRole("dialog", {
      name: "审核投稿",
      exact: true,
    });
    await expect(drawer.getByLabel("提示 1", { exact: true })).toBeDisabled();
    resumeReview();
    await expect(
      drawer.getByRole("button", { name: "直接收录", exact: true }),
    ).toBeEnabled();
    for (const method of ["icon", "footer", "escape", "mask"]) {
      await drawer.getByLabel("提示 1", { exact: true }).fill("审核退出快照");
      await retainedClose(reviewPage, drawer, () =>
        method === "icon"
          ? drawer.locator(".ant-drawer-close").click()
          : method === "footer"
            ? drawer
                .locator(".ant-drawer-footer")
                .getByRole("button", { name: "关闭", exact: true })
                .click()
            : method === "escape"
              ? reviewPage.keyboard.press("Escape")
              : reviewPage
                  .locator(".ant-drawer-mask")
                  .click({ position: { x: 5, y: 5 } }),
      );
      await expect(
        reviewRow.getByRole("button", { name: "审核", exact: true }),
      ).toBeFocused();
      await reviewRow
        .getByRole("button", { name: "审核", exact: true })
        .click();
      await expect(drawer.getByLabel("提示 1", { exact: true })).toHaveValue(
        "体验提示第1条",
      );
    }
    await drawer.getByRole("button", { name: "驳回", exact: true }).click();
    const rejecting = reviewPage.getByRole("dialog", {
      name: "驳回投稿",
      exact: true,
    });
    for (const method of ["cancel", "icon", "escape", "mask"]) {
      await rejecting
        .getByLabel("驳回原因", { exact: true })
        .fill("需要补充更具体的提示");
      await retainedClose(reviewPage, rejecting, () =>
        method === "cancel"
          ? rejecting.getByRole("button", { name: "取消", exact: true }).click()
          : method === "icon"
            ? rejecting.locator(".ant-modal-close").click()
            : method === "escape"
              ? reviewPage.keyboard.press("Escape")
              : reviewPage
                  .locator(".ant-modal-wrap")
                  .click({ position: { x: 5, y: 5 } }),
      );
      await expect(
        drawer.getByRole("button", { name: "驳回", exact: true }),
      ).toBeFocused();
      if (method !== "mask")
        await drawer.getByRole("button", { name: "驳回", exact: true }).click();
    }
    await drawer.getByRole("button", { name: "驳回", exact: true }).click();
    await rejecting
      .getByLabel("驳回原因", { exact: true })
      .fill("需要补充更具体的提示");
    await retainedClose(reviewPage, rejecting, () =>
      rejecting.getByRole("button", { name: "确认驳回", exact: true }).click(),
    );
    await expect(drawer).not.toBeVisible();
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await row.getByRole("button", { name: "查看", exact: true }).click();
    await expect(detail).toContainText("需要补充更具体的提示");
    await detail
      .getByRole("button", { name: "修改后提交", exact: true })
      .click();
    await retainedClose(page, edit, () =>
      edit.getByRole("button", { name: "提交审核", exact: true }).click(),
    );
    await expect(edit).not.toBeVisible();
    await reviewPage
      .getByRole("button", { name: "刷新投稿", exact: true })
      .click();
    await reviewRow.getByRole("button", { name: "审核", exact: true }).click();
    await drawer
      .getByLabel("提示 1", { exact: true })
      .fill("审核后更具体的提示");
    await reviewPage.screenshot({
      path: ".local/question-submissions/reviewer.png",
    });
    await retainedClose(reviewPage, drawer, () =>
      drawer.getByRole("button", { name: "修改并收录", exact: true }).click(),
    );
    await expect(drawer).not.toBeVisible();
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await row.getByRole("button", { name: "查看", exact: true }).click();
    await expect(detail).toContainText("已收录");
    await expect(detail).toContainText("审核后更具体的提示");
    await expect(
      detail.getByRole("button", { name: "修改投稿", exact: true }),
    ).toHaveCount(0);
    await retainedClose(page, detail, () => page.keyboard.press("Escape"));
  } finally {
    resumeReview();
    await reviewerContext.close().catch(() => undefined);
    const cleanup = `import {db} from './apps/api/src/core/context'; import {users,auditLogs,partySubmissions,partyWordBank,adminRoles} from '@cinegather/database'; import {eq,inArray} from 'drizzle-orm'; const ids=[process.env.AUTHOR!,process.env.REVIEWER!]; await db.delete(auditLogs).where(inArray(auditLogs.actorId,ids)); await db.delete(partySubmissions).where(eq(partySubmissions.userId,ids[0])); await db.delete(partyWordBank).where(eq(partyWordBank.authorUserId,ids[0])); await db.delete(users).where(inArray(users.id,ids)); await db.delete(adminRoles).where(eq(adminRoles.id,process.env.ROLE!)); process.exit(0);`;
    execFileSync("bun", ["-e", cleanup], {
      env: {
        ...process.env,
        AUTHOR: author.user.id,
        REVIEWER: reviewer.user.id,
        ROLE: roleId,
      },
      stdio: "pipe",
    });
  }
});
