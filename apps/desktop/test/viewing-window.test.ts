import { test, expect } from "bun:test";
import { allowedViewingWindow } from "../src/main/viewing-window-policy";
test("only the dedicated same-origin viewing entry can create a child", () => {
  for (const main of [
    "http://127.0.0.1:5173/index.html",
    "app://cinegather/index.html",
  ]) {
    const good = new URL("watch.html", main).href;
    expect(allowedViewingWindow(good, "cinegather-watch", main)).toBe(true);
    for (const bad of [
      "https://evil.test/watch.html",
      new URL("index.html", main).href,
      good + "?code=x",
      good + "#x",
      "javascript:alert(1)",
    ])
      expect(allowedViewingWindow(bad, "cinegather-watch", main)).toBe(false);
    expect(allowedViewingWindow(good, "other", main)).toBe(false);
  }
});
