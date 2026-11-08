import { expect, type Locator, type Page } from "@playwright/test";
/** Freeze the actual leave animations and inspect the still-mounted snapshot. */
export async function retainedClose(
  page: Page,
  panel: Locator,
  close: () => Promise<unknown>,
) {
  const text = await panel.innerText();
  const fields = await panel.locator("input,textarea").evaluateAll((nodes) =>
    nodes.map((n) => ({
      value: (n as HTMLInputElement).value,
      checked: (n as HTMLInputElement).checked,
    })),
  );
  await panel.evaluate((element) => {
    const root = element.closest(".ant-modal-root,.ant-drawer")!,
      seen = new Set<EventTarget>();
    const probe = { count: 0 };
    const handler = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element) || !root.contains(target)) return;
      const leaving =
        event instanceof AnimationEvent
          ? /Out/i.test(event.animationName) &&
            target.matches(".ant-modal,.ant-modal-mask")
          : event instanceof TransitionEvent &&
            target.className.includes("leave-active") &&
            target.matches(".ant-drawer-mask,.ant-drawer-content-wrapper");
      if (!leaving) return;
      seen.add(target);
      probe.count = seen.size;
      target.getAnimations().forEach((a) => a.pause());
    };
    document.addEventListener("animationstart", handler);
    document.addEventListener("transitionrun", handler);
    Object.assign(window, {
      submissionMotion: probe,
      submissionMotionCleanup: () => {
        document.removeEventListener("animationstart", handler);
        document.removeEventListener("transitionrun", handler);
      },
    });
  });
  await close();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { submissionMotion: { count: number } })
            .submissionMotion.count,
      ),
    )
    .toBeGreaterThanOrEqual(2);
  expect(await panel.innerText()).toBe(text);
  expect(
    await panel.locator("input,textarea").evaluateAll((nodes) =>
      nodes.map((n) => ({
        value: (n as HTMLInputElement).value,
        checked: (n as HTMLInputElement).checked,
      })),
    ),
  ).toEqual(fields);
  await page.evaluate(() => {
    (
      window as unknown as { submissionMotionCleanup(): void }
    ).submissionMotionCleanup();
    document
      .getAnimations()
      .filter((a) => a.playState === "paused")
      .forEach((a) => a.finish());
  });
  await expect(panel).not.toBeVisible();
}
