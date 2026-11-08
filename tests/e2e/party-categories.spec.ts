import { test, expect, type Page, type Locator } from "@playwright/test";
import { execFileSync } from "node:child_process";
const api = "http://127.0.0.1:14310/api/v1";
async function closeWithMotion(
  page: Page,
  dialog: Locator,
  close: () => Promise<unknown>,
) {
  await expect(page.locator(".ant-select-dropdown:visible")).toHaveCount(0);
  const normalized = (text: string) =>
    text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line, index, lines) => index === 0 || line !== lines[index - 1])
      .join("\n");
  const content = normalized(await dialog.innerText());
  const fields = await dialog
    .locator("input,textarea")
    .evaluateAll((elements) =>
      elements.map((e) => ({
        value: (e as HTMLInputElement).value,
        checked: (e as HTMLInputElement).checked,
      })),
    );
  await dialog.evaluate((panel) => {
    const root = panel.closest(".ant-modal-root");
    const probe = { names: [] as string[] };
    const handler = (event: AnimationEvent) => {
      if (
        !(event.target instanceof Element) ||
        !root?.contains(event.target) ||
        !event.target.matches(".ant-modal,.ant-modal-mask") ||
        !/Out/i.test(event.animationName)
      )
        return;
      probe.names.push(event.animationName);
      event.target.getAnimations().forEach((a) => a.pause());
    };
    document.addEventListener("animationstart", handler);
    Object.assign(window, {
      categoryMotion: probe,
      categoryMotionCleanup: () =>
        document.removeEventListener("animationstart", handler),
    });
  });
  await close();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { categoryMotion: { names: string[] } })
            .categoryMotion.names.length,
      ),
    )
    .toBeGreaterThanOrEqual(2);
  expect(normalized(await dialog.innerText())).toBe(content);
  expect(
    await dialog.locator("input,textarea").evaluateAll((elements) =>
      elements.map((e) => ({
        value: (e as HTMLInputElement).value,
        checked: (e as HTMLInputElement).checked,
      })),
    ),
  ).toEqual(fields);
  await page.evaluate(() => {
    (
      window as unknown as { categoryMotionCleanup(): void }
    ).categoryMotionCleanup();
    document
      .getAnimations()
      .filter((a) => a.playState === "paused")
      .forEach((a) => a.finish());
  });
  await expect(dialog).not.toBeVisible();
}
test("party category administration supports optional second level and retained exit animation", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const suffix = crypto.randomUUID().slice(0, 8),
    password = "Category fixture 123!";
  const account = await (
    await page.request.post(api + "/accounts/register", {
      data: {
        username: "catui_" + suffix,
        displayName: "分类管理体验",
        password,
      },
    })
  ).json();
  execFileSync(
    "bun",
    ["tools/operations/superadmin.ts", "grant", account.user.id],
    { stdio: "pipe" },
  );
  await page.goto("/admin");
  await page.getByLabel("用户名", { exact: true }).fill(account.user.username);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录映聚", exact: true }).click();
  await page.getByRole("tab", { name: "题库", exact: false }).click();
  const actions = page.getByRole("group", { name: "题库操作", exact: true });
  const filters = page.getByRole("group", { name: "题库筛选", exact: true });
  await expect(actions).toBeVisible();
  await expect(filters).toBeVisible();
  const a = await actions.boundingBox(),
    f = await filters.boundingBox();
  expect(a!.y + a!.height).toBeLessThan(f!.y);
  for (const name of ["新增题目", "批量导入", "分类管理", "开局规则"])
    await expect(
      actions.getByRole("button", { name, exact: true }),
    ).toBeVisible();
  await expect(
    filters.getByRole("button", { name: "新增题目", exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 1080, height: 800 });
  const compactAction = await actions.boundingBox(),
    compactFilter = await filters.boundingBox();
  expect(compactAction!.y + compactAction!.height).toBeLessThan(
    compactFilter!.y,
  );
  const buttonBoxes = await actions
    .getByRole("button")
    .evaluateAll((buttons) => buttons.map((b) => b.getBoundingClientRect().y));
  expect(new Set(buttonBoxes.map((y) => Math.round(y))).size).toBe(1);
  await page.screenshot({ path: ".local/party-categories/toolbar.png" });
  await page.getByRole("button", { name: "分类管理", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "题库分类", exact: true });
  await expect(panel).toBeVisible();
  await page.screenshot({
    path: ".local/party-categories/admin-categories.png",
  });
  await panel.getByRole("button", { name: "新增分类" }).click();
  const edit = page.getByRole("dialog", { name: "新增分类", exact: true });
  await edit.getByLabel("分类名称", { exact: true }).fill("一级直属" + suffix);
  await edit.getByRole("button", { name: "保存", exact: true }).click();
  await expect(edit).not.toBeVisible();
  await expect(
    panel.getByText("一级直属" + suffix, { exact: true }),
  ).toBeVisible();
  await panel
    .getByRole("row")
    .filter({ hasText: "一级直属" + suffix })
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "编辑分类", exact: true });
  await expect(editor.getByLabel("分类名称", { exact: true })).toHaveValue(
    "一级直属" + suffix,
  );
  await closeWithMotion(page, editor, () =>
    editor.getByRole("button", { name: "取消", exact: true }).click(),
  );
  await panel
    .getByRole("button", { name: "关闭", exact: true })
    .first()
    .click();
  await expect(panel).not.toBeVisible();
  await page.getByRole("button", { name: "新增题目", exact: true }).click();
  const word = page.getByRole("dialog", { name: "新增题目", exact: true });
  await word.getByLabel("答案", { exact: true }).fill("直属题" + suffix);
  await word.getByRole("combobox", { name: "题目分类" }).click();
  await page
    .getByText("一级直属" + suffix, { exact: true })
    .last()
    .click();
  for (let i = 1; i <= 3; i++)
    await word.getByLabel("提示 " + i, { exact: true }).fill("具体线索" + i);
  await word.getByRole("button", { name: "保存", exact: true }).click();
  await expect(word).not.toBeVisible();
  await page.getByLabel("搜索题库", { exact: true }).fill("直属题" + suffix);
  await page.getByLabel("搜索题库", { exact: true }).press("Enter");
  await expect(
    page.getByRole("row").filter({ hasText: "直属题" + suffix }),
  ).toContainText("一级直属" + suffix);
  const wordRow = page.getByRole("row").filter({ hasText: "直属题" + suffix });
  await wordRow.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "批量归类（1）", exact: true })
    .click();
  const moving = page.getByRole("dialog", {
    name: "批量修改题目分类",
    exact: true,
  });
  await moving.getByRole("combobox", { name: "题目分类" }).click();
  await page.getByText("游戏 / 明日方舟", { exact: true }).last().click();
  await closeWithMotion(page, moving, () =>
    moving.getByRole("button", { name: "保存", exact: true }).click(),
  );
  await expect(wordRow).toContainText("游戏 / 明日方舟");
  await wordRow.getByRole("button", { name: "删除", exact: true }).click();
  const deleteWord = page.getByRole("dialog", {
    name: "删除题目？",
    exact: true,
  });
  await deleteWord.getByRole("button", { name: "删除", exact: true }).click();
  await expect(deleteWord).not.toBeVisible();
  await expect(wordRow).toHaveCount(0);
  await page.getByRole("button", { name: "分类管理", exact: true }).click();
  const categoryRow = panel
    .getByRole("row")
    .filter({ hasText: "一级直属" + suffix });
  await categoryRow.getByRole("button", { name: "删除", exact: true }).click();
  const deleting = page.getByRole("dialog", {
    name: "删除分类？",
    exact: true,
  });
  await closeWithMotion(page, deleting, () =>
    page
      .locator(".ant-modal-wrap:visible")
      .last()
      .click({ position: { x: 10, y: 10 } }),
  );
  await categoryRow.getByRole("button", { name: "删除", exact: true }).click();
  await closeWithMotion(page, deleting, () =>
    deleting.getByRole("button", { name: "删除", exact: true }).click(),
  );
  await expect(categoryRow).toHaveCount(0);
  await closeWithMotion(page, panel, () =>
    panel.getByRole("button", { name: "关闭", exact: true }).first().click(),
  );
  await page.getByRole("button", { name: "开局规则", exact: true }).click();
  const rules = page.getByRole("dialog", { name: "聚会游戏开局规则" });
  await expect(rules.getByRole("spinbutton").first()).toHaveValue("20");
  await closeWithMotion(page, rules, () => rules.press("Escape"));
  await expect(
    page.getByRole("button", { name: "开局规则", exact: true }),
  ).toBeFocused();
});

test("room category selection synchronizes across two browsers and draws only selected words", async ({
  page,
  browser,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const { registerTestAccount } = await import("./helpers/account");
  await page.goto("/");
  await registerTestAccount(page, "选题房主");
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称", { exact: true }).fill("分类选题验证");
  await page.getByRole("button", { name: "创建并进入", exact: true }).click();
  await expect(page.locator(".connection")).toContainText("已连接", {
    timeout: 30000,
  });
  const code = (
    await page
      .getByRole("button", { name: "复制房间号", exact: true })
      .innerText()
  ).trim();
  const ctx = await browser.newContext();
  const friend = await ctx.newPage();
  try {
    await friend.goto("/");
    await registerTestAccount(friend, "选题好友");
    await friend.getByRole("button", { name: "加入房间", exact: true }).click();
    await friend.getByLabel("房间号或邀请链接").fill(code);
    await friend.getByRole("button", { name: "进入房间", exact: true }).click();
    await expect(friend.locator(".connection")).toContainText("已连接", {
      timeout: 30000,
    });
    await page.getByRole("button", { name: "聚会游戏", exact: true }).click();
    await page
      .getByRole("dialog", { name: "聚会游戏", exact: true })
      .getByRole("button", { name: "你画我猜", exact: true })
      .click();
    await page.getByRole("button", { name: "选择分类", exact: true }).click();
    const picker = page.getByRole("dialog", {
      name: "选择题目分类",
      exact: true,
    });
    await picker.getByRole("button", { name: "清空选择", exact: true }).click();
    await picker.getByRole("checkbox", { name: /^明日方舟/ }).check();
    await expect(picker).toContainText("1 个分类，23 道可用题");
    await picker.evaluate(async (element) => {
      await Promise.all(
        element
          .getAnimations({ subtree: true })
          .map((a) => a.finished.catch(() => {})),
      );
    });
    await page.screenshot({
      path: ".local/party-categories/category-picker.png",
    });
    await closeWithMotion(page, picker, () =>
      picker.getByRole("button", { name: "保存选择", exact: true }).click(),
    );
    await expect(
      friend.getByText("已选 1 个分类，共 23 道可用题", { exact: true }),
    ).toBeVisible();
    await expect(
      friend.getByRole("button", { name: "选择分类", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "参加游戏", exact: true }).click();
    await friend.getByRole("button", { name: "参加游戏", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "开始游戏", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "选择分类", exact: true }).click();
    await picker.getByRole("button", { name: "清空选择", exact: true }).click();
    await picker.getByRole("checkbox", { name: /^三角洲行动/ }).check();
    await expect(picker).toContainText("1 个分类，2 道可用题");
    await picker.getByRole("button", { name: "保存选择", exact: true }).click();
    await expect(picker).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "开始游戏", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "选择分类", exact: true }).click();
    await picker.getByRole("button", { name: "清空选择", exact: true }).click();
    await picker.getByRole("checkbox", { name: /^明日方舟/ }).check();
    await picker.getByRole("button", { name: "保存选择", exact: true }).click();
    await expect(picker).not.toBeVisible();
    await page.getByRole("button", { name: "开始游戏", exact: true }).click();
    await expect(page.locator(".party-choices")).toBeVisible();
    const { partyModernGameWords } = await import(
      "../../apps/api/src/modules/party/data/party-modern-game-words"
    );
    const answers = new Set(
      partyModernGameWords
        .filter((w) => w.category === "明日方舟")
        .map((w) => w.answer),
    );
    const choices = await page
      .locator(".party-choices")
      .getByRole("button")
      .allTextContents();
    expect(choices.filter((c) => answers.has(c.trim())).length).toBe(3);
    await page.screenshot({ path: ".local/party-categories/game.png" });
  } finally {
    await ctx.close();
  }
});
