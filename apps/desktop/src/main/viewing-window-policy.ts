export function allowedViewingWindow(
  raw: string,
  frameName: string,
  mainURL: string,
) {
  try {
    const url = new URL(raw),
      main = new URL(mainURL),
      expected = new URL("watch.html", main);
    return (
      frameName === "cinegather-watch" &&
      ["app:", "http:", "https:"].includes(main.protocol) &&
      url.href === expected.href &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
