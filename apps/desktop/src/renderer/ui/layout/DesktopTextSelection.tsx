import { Global, css } from "@emotion/react";

/** Cover body-level portals and desktop notification/overlay documents too. */
export function DesktopTextSelection() {
  if (!window.desktop && !window.memberOverlay && !window.notificationCard)
    return null;
  return (
    <Global
      styles={css`
        body {
          -webkit-user-select: none;
          user-select: none;
        }
        input,
        textarea,
        [contenteditable=""],
        [contenteditable="true" i],
        [contenteditable="plaintext-only" i],
        [data-selectable="text"],
        .ant-alert-error .ant-alert-title,
        .ant-alert-error .ant-alert-description,
        .ant-alert-warning .ant-alert-title,
        .ant-alert-warning .ant-alert-description,
        .ant-message-error .ant-message-notice-title,
        .ant-message-warning .ant-message-notice-title,
        .ant-form-item-explain-error {
          -webkit-user-select: text;
          user-select: text;
        }
      `}
    />
  );
}
