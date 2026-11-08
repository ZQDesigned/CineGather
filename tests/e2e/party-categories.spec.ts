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
  const categoryFilter = filters.getByRole("combobox", {
    name: "题目分类",
    exact: true,
  });
  await categoryFilter.click();
  await categoryFilter.fill("游戏");
  const filterTree = page.getByRole("tree").last();
  await expect(filterTree.getByText("游戏", { exact: true })).toBeVisible();
  await filterTree.getByText("游戏", { exact: true }).click();
  await expect(filters).toContainText("游戏");
  await filters.getByRole("button", { name: "Clear", exact: true }).click();
  await page.getByRole("button", { name: "分类管理", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "题库分类", exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("tree")).toBeVisible();
  await expect(
    panel
      .getByRole("treeitem")
      .filter({ has: page.getByText("游戏", { exact: true }) }),
  ).toHaveAttribute("aria-expanded", "true");
  await panel.evaluate(async (e) => {
    await Promise.all(
      e.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {})),
    );
  });
  await page.screenshot({
    path: ".local/party-categories/tree-categories.png",
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
    .getByRole("treeitem")
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
  await moving.getByRole("combobox", { name: "题目分类" }).fill("明日方舟");
  const categoryTree = page.getByRole("tree").last();
  await expect(categoryTree).toBeVisible();
  await categoryTree.getByText("明日方舟", { exact: true }).click();
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
    .getByRole("treeitem")
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
  await page.getByRole("button", { name: "批量导入", exact: true }).click();
  const importer = page.getByRole("dialog", {
    name: "批量导入题目",
    exact: true,
  });
  const input = importer.getByRole("textbox", {
    name: "题库导入内容",
    exact: true,
  });
  const csv =
    "answer,parentCategory,category,clue1,clue2,clue3,enabled,modes\n导入预览" +
    suffix +
    ",,交通,一,二,三,true,draw|quiz";
  const choose = async (name: string, content: string) => {
    const chosen = page.waitForEvent("filechooser");
    await importer
      .getByRole("button", { name: "选择题库文件", exact: true })
      .click();
    await (
      await chosen
    ).setFiles({
      name,
      mimeType: name.endsWith(".json") ? "application/json" : "text/csv",
      buffer: Buffer.from(content),
    });
  };
  await choose("题库测试.csv", csv);
  await expect(input).toHaveValue(csv);
  await expect(importer.locator(".ant-upload-list-item")).toHaveCount(1);
  await expect(importer).toContainText("题库测试.csv");
  await importer.screenshot({
    path: ".local/party-categories/antd-upload.png",
  });
  await importer.getByRole("button", { name: "校验预览", exact: true }).click();
  await expect(importer).toContainText("待新增 1 道");
  const json = JSON.stringify([
    {
      answer: "导入JSON" + suffix,
      category: "交通",
      clues: ["一", "二", "三"],
      enabled: true,
      modes: ["quiz"],
    },
  ]);
  await choose("题库测试.json", json);
  await expect(input).toHaveValue(json);
  await expect(importer.locator(".ant-upload-list-item")).toHaveCount(1);
  await expect(importer).not.toContainText("题库测试.csv");
  await expect(importer).not.toContainText("待新增 1 道");
  await choose("超大.csv", "A".repeat(200001));
  await expect(
    page.getByText("文件不能超过 200 KB", { exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue(json);
  await choose("错误格式.txt", "invalid");
  await expect(
    page.getByText("请选择 CSV 或 JSON 文件", { exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue(json);
  await importer.locator(".ant-upload-list-item").getByRole("button").click();
  await expect(input).toHaveValue("");
  await expect(importer.locator(".ant-upload-list-item")).toHaveCount(0);
  await choose("重新选择.json", json);
  await expect(input).toHaveValue(json);
  await closeWithMotion(page, importer, () =>
    importer.getByRole("button", { name: "取消", exact: true }).click(),
  );
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
    await page.getByRole("button", { name: /选择分类$/ }).click();
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
    await expect(friend.getByRole("button", { name: /选择分类$/ })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "参加游戏", exact: true }).click();
    await friend.getByRole("button", { name: "参加游戏", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "开始游戏", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: /选择分类$/ }).click();
    await picker.getByRole("button", { name: "清空选择", exact: true }).click();
    await picker.getByRole("checkbox", { name: /^三角洲行动/ }).check();
    await expect(picker).toContainText("1 个分类，2 道可用题");
    await picker.getByRole("button", { name: "保存选择", exact: true }).click();
    await expect(picker).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "开始游戏", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: /选择分类$/ }).click();
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
    await page
      .locator(".party-choices")
      .getByRole("button", {
        name: choices.find((c) => answers.has(c.trim()))!,
        exact: true,
      })
      .click();
    const colorButton = page.getByRole("button", {
      name: "画笔颜色",
      exact: true,
    });
    await expect(colorButton).toBeVisible();
    await colorButton.click();
    const colorPanel = page.getByRole("dialog", {
      name: "画笔颜色选择器",
      exact: true,
    });
    await expect(colorPanel).toBeVisible();
    await colorPanel.getByRole("textbox").fill("33bb77");
    await expect(colorButton.locator(".board-color-swatch")).toHaveCSS(
      "background-color",
      "rgb(51, 187, 119)",
    );
    await colorPanel.screenshot({
      path: ".local/party-categories/antd-color-picker.png",
    });
    await page.evaluate(() => {
      const control = new AbortController(),
        probe = { exiting: false };
      document.addEventListener(
        "animationstart",
        (event) => {
          if (
            !(event.target instanceof Element) ||
            !event.target.matches(".ant-popover") ||
            !event.target.querySelector('[aria-label="画笔颜色选择器"]') ||
            !/Out/i.test(event.animationName)
          )
            return;
          probe.exiting = true;
          event.target.getAnimations().forEach((a) => a.pause());
        },
        { signal: control.signal },
      );
      Object.assign(window, {
        boardColorMotion: probe,
        stopBoardColorMotion: () => control.abort(),
      });
    });
    await colorPanel.press("Escape");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { boardColorMotion: { exiting: boolean } })
              .boardColorMotion.exiting,
        ),
      )
      .toBe(true);
    await expect(colorPanel.getByRole("textbox")).toHaveValue("33bb77");
    await page.evaluate(() => {
      (
        window as unknown as { stopBoardColorMotion(): void }
      ).stopBoardColorMotion();
      document
        .getAnimations()
        .filter((a) => a.playState === "paused")
        .forEach((a) => a.finish());
    });
    await expect(colorPanel).not.toBeVisible();
    await expect(colorButton).toBeFocused();
    const canvas = page.getByRole("img", { name: "协作白板", exact: true }),
      box = await canvas.boundingBox();
    await page.mouse.move(
      box!.x + box!.width * 0.4,
      box!.y + box!.height * 0.4,
    );
    await page.mouse.down();
    await page.mouse.move(
      box!.x + box!.width * 0.6,
      box!.y + box!.height * 0.6,
      { steps: 10 },
    );
    await page.mouse.up();
    await expect(canvas.locator('path[stroke="#33bb77"]')).toBeVisible();
    await expect(
      friend
        .getByRole("img", { name: "协作白板", exact: true })
        .locator('path[stroke="#33bb77"]'),
    ).toBeVisible();
    await page.screenshot({ path: ".local/party-categories/game.png" });
  } finally {
    await ctx.close();
  }
});
