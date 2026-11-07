import { expect, type Page } from "@playwright/test";
import { clientUpdateOrigin } from "@cinegather/contracts";

/** Verify the API selected by the packaged renderer itself, not a manual fetch to a known-good URL. */
export async function verifyPackagedDefaultServer(page: Page) {
  await expect(
    page.getByRole("button", { name: "登录映聚", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  expect(
    await page.evaluate(() => localStorage.getItem("cinegather.api")),
  ).toBeNull();
  const registration = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/v1/registration",
    { timeout: 20000 },
  );
  await page.reload();
  const response = await registration;
  expect(new URL(response.url()).origin).toBe(clientUpdateOrigin);
  expect(response.status()).toBe(200);
  expect(typeof (await response.json()).enabled).toBe("boolean");
}
