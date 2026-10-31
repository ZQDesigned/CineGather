import { expect, test } from "bun:test";
import { SnackbarQueue } from "../src/snackbar";

function setup() {
  let now = 0,
    serial = 0;
  const jobs = new Map<number, { at: number; run(): void }>();
  const queue = new SnackbarQueue({
    now: () => now,
    setTimeout: (run, delay) => {
      const id = ++serial;
      jobs.set(id, { at: now + delay, run });
      return id;
    },
    clearTimeout: (id) => {
      jobs.delete(id as number);
    },
  });
  const advance = (duration: number) => {
    const until = now + duration;
    while (true) {
      const next = [...jobs]
        .filter(([, v]) => v.at <= until)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at;
      jobs.delete(next[0]);
      next[1].run();
    }
    now = until;
  };
  return { queue, jobs, advance };
}

test("the same failure from concurrent owners is only shown once, without extending its lifetime", () => {
  const { queue, advance } = setup();
  queue.host(0);
  const id = queue.show({ text: "连接失败", tone: "error" });
  advance(3000);
  expect(queue.show({ text: " 连接失败 ", tone: "error" })).toBe(id);
  advance(3000);
  expect(queue.snapshot().phase).toBe("exiting");
  advance(180);
  expect(queue.snapshot().item).toBeUndefined();
  expect(queue.show({ text: "连接失败", tone: "error" })).toBeUndefined();
  advance(8000);
  const next = queue.show({ text: "连接失败", tone: "error" });
  expect(next).toBeDefined();
  expect(next).not.toBe(id);
});

test("messages leave before the next enters, and an old dismissal cannot hide a newer message", () => {
  const { queue, advance } = setup();
  queue.host(0);
  const first = queue.show({ text: "已发送", tone: "success" });
  const second = queue.show({ text: "保存失败", tone: "error" });
  queue.dismiss(first);
  expect(queue.snapshot().item?.id).toBe(first);
  expect(queue.snapshot().phase).toBe("exiting");
  advance(180);
  expect(queue.snapshot().item?.id).toBe(second);
  queue.dismiss(first);
  advance(2820);
  expect(queue.snapshot().item?.id).toBe(second);
  advance(3180);
  expect(queue.snapshot().phase).toBe("exiting");
});

test("pending duplicate content merges and a burst retains only three pending messages", () => {
  const { queue, advance } = setup();
  queue.host(0);
  queue.show({ text: "第一条" });
  queue.show({ text: "第二条" });
  queue.show({ text: "第二条" });
  for (let i = 3; i <= 6; i++) queue.show({ text: `第${i}条` });
  queue.dismiss();
  advance(180);
  expect(queue.snapshot().item?.text).toBe("第4条");
  queue.dismiss();
  advance(180);
  expect(queue.snapshot().item?.text).toBe("第5条");
  queue.dismiss();
  advance(180);
  expect(queue.snapshot().item?.text).toBe("第6条");
  queue.dismiss();
  advance(180);
  expect(queue.snapshot().item).toBeUndefined();
});

test("only the frontmost surface owns presentation and ownership changes do not restart timers", () => {
  const { queue, advance } = setup();
  const root = queue.host(0);
  const sheet = queue.host(10);
  queue.show({ text: "面板操作失败", tone: "error" });
  expect(queue.snapshot().host).toBe(sheet.id);
  advance(2000);
  const dialog = queue.host(20);
  expect(queue.snapshot().host).toBe(dialog.id);
  dialog.release();
  expect(queue.snapshot().host).toBe(sheet.id);
  sheet.release();
  expect(queue.snapshot().host).toBe(root.id);
  advance(4000);
  expect(queue.snapshot().phase).toBe("exiting");
  root.release();
  advance(180);
  expect(queue.snapshot().item).toBeUndefined();
});

test("feedback waits for a host, drops stale queued items, and does not replay background operations", () => {
  const { queue, advance } = setup();
  queue.show({ text: "尚无界面" });
  advance(16000);
  queue.host(0);
  expect(queue.snapshot().item).toBeUndefined();
  queue.show({ text: "前台反馈" });
  queue.setForeground(false);
  expect(queue.snapshot().item).toBeUndefined();
  expect(queue.show({ text: "后台反馈" })).toBeUndefined();
  queue.setForeground(true);
  expect(queue.snapshot().item).toBeUndefined();
  expect(queue.show({ text: "回到前台" })).toBeDefined();
});

test("assistive timeouts can extend one message without affecting the next message", () => {
  const { queue, advance } = setup();
  queue.host(0);
  const first = queue.show({ text: "需要阅读的提示" });
  queue.extend(first!, 12000);
  advance(5000);
  expect(queue.snapshot().phase).toBe("visible");
  queue.dismiss(first);
  advance(180);
  const second = queue.show({ text: "下一条" });
  queue.extend(first!, 20000);
  advance(4000);
  expect(queue.snapshot().item?.id).toBe(second);
  expect(queue.snapshot().phase).toBe("exiting");
});

test("ending an account session clears pending private feedback and cancels its timers", () => {
  const { queue, advance } = setup();
  queue.host(0);
  queue.show({ text: "好友甲的房间消息" });
  queue.show({ text: "好友乙的邀请" });
  queue.clear();
  expect(queue.snapshot().item).toBeUndefined();
  const next = queue.show({ text: "登录失败", tone: "error" });
  advance(4200);
  expect(queue.snapshot().item?.id).toBe(next);
});

test("repeated polling failures stay quiet until the same failure has stopped recurring", () => {
  const { queue, advance } = setup();
  queue.host(0);
  const input = { text: "暂时无法连接", tone: "error" as const };
  queue.show(input);
  for (let i = 0; i < 20; i++) {
    advance(2000);
    queue.show(input);
    if (i > 3) expect(queue.snapshot().item).toBeUndefined();
  }
  advance(8000);
  expect(queue.show(input)).toBeDefined();
});
