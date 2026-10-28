import { Global, css } from "@emotion/react";
import styled from "@emotion/styled";

export const cinemaFont =
  'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
export function GlobalStyles() {
  return (
    <Global
      styles={css`
        :root {
          font-family: ${cinemaFont};
          color: #e9e9ef;
          background: #0d0f14;
          font-synthesis: none;
          font-weight: 400;
          --muted: #838593;
          --line: #ffffff0e;
          --purple: #b39bff;
          --accent: #bca5ff;
          --bg: #0d0f14;
        }
        * {
          box-sizing: border-box;
        }
        body {
          margin: 0;
          min-width: 760px;
        }
        button,
        input,
        textarea {
          font: inherit;
        }
        a {
          color: inherit;
          text-decoration: none;
        }
        svg {
          flex-shrink: 0;
        }
        .ant-btn {
          vertical-align: middle;
        }
        h1,
        h2,
        h3,
        p {
          margin: 0;
        }
        button,
        a,
        input,
        textarea {
          -webkit-tap-highlight-color: transparent;
        }
        button:focus-visible,
        a:focus-visible {
          outline: 2px solid #baa4ff;
          outline-offset: 3px;
        }
        .ant-message {
          top: 46px !important;
        }
        .ant-notification-notice-description {
          overflow-wrap: anywhere;
        }
        @media (prefers-reduced-motion: reduce) {
          *,
          *::before,
          *::after {
            animation-duration: 0.01ms !important;
            transition-duration: 0.01ms !important;
          }
        }
      `}
    />
  );
}

export const AppSurface = styled.div`
  & {
    display: flex;
    height: 100dvh;
    min-height: 0;
    background:
      radial-gradient(ellipse at 70% -30%, #29213b2b, transparent 60%),
      var(--bg);
  }
  .sidebar {
    width: 222px;
    flex-shrink: 0;
    border-right: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    background: #101217;
    position: fixed;
    inset: 0 auto 0 0;
    padding: 40px 16px 0;
    z-index: 3;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 11px;
    margin: 0 12px 47px;
    font-size: 24px;
    letter-spacing: 2px;
    font-weight: 650;
  }
  .brand-icon {
    width: 41px;
    height: 41px;
    background: #bda8ff;
    color: #201931;
    border-radius: 12px;
    display: grid;
    place-items: center;
    transform: rotate(-5deg);
  }
  .nav-label {
    font-size: 10px;
    letter-spacing: 1.4px;
    color: #5d6270;
    padding: 0 14px;
    margin-bottom: 12px;
  }
  .room-label {
    margin-top: 35px;
  }
  .recent-rooms {
    overflow: auto;
  }
  .sidebar-empty {
    font-size: 11px;
    line-height: 1.9;
    color: #535867;
    padding: 10px 14px;
  }
  .sidebar-bottom {
    margin-top: auto;
    padding-top: 24px;
  }
  .profile {
    display: flex;
    align-items: center;
    gap: 9px;
    border-top: 1px solid var(--line);
    padding: 18px 1px;
    margin-top: 15px;
    font-size: 11px;
  }
  .profile-details {
    flex: 1;
    min-width: 0;
  }
  .profile-name,
  .profile small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .profile > .ant-btn {
    flex-shrink: 0;
  }
  .profile small {
    display: block;
    font-size: 9px;
    color: #626775;
    margin-top: 5px;
  }
  .avatar {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 13px;
    flex-shrink: 0;
  }
  .purple {
    background: #b39bff20;
    color: #c4b1ff;
  }
  .amber {
    background: #d8aa7420;
    color: #e3be92;
  }
  .workspace {
    margin-left: 222px;
    width: calc(100% - 222px);
    height: 100dvh;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .topbar {
    height: 56px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--line);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 35px;
    -webkit-app-region: drag;
  }
  .topbar button {
    -webkit-app-region: no-drag;
  }
  .breadcrumb {
    display: flex;
    align-items: center;
    gap: 13px;
    font-size: 11px;
    color: #c8c9d3;
  }
  .breadcrumb > span {
    color: #454955;
  }
  .topbar-right {
    display: flex;
    align-items: center;
    gap: 20px;
  }
  &[data-platform="win32"] .topbar {
    gap: 16px;
    padding-right: 12px;
  }
  &[data-platform="win32"] .topbar .ant-breadcrumb {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }
  &[data-platform="win32"] .topbar .ant-breadcrumb ol {
    flex-wrap: nowrap;
  }
  &[data-platform="win32"] .topbar .ant-breadcrumb li:last-child {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  &[data-platform="win32"] .topbar-right {
    min-width: 0;
    gap: 12px;
  }
  &[data-platform="win32"] .topbar-right > .ant-btn,
  &[data-platform="win32"] .connection,
  &[data-platform="win32"] .version {
    flex-shrink: 0;
  }
  &[data-platform="win32"] .current-room-link {
    flex: 1 1 auto;
  }
  &.cinema[data-platform="win32"] .topbar {
    display: flex;
  }
  .window-controls {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 2px;
    -webkit-app-region: no-drag;
  }
  .window-controls .ant-btn {
    width: 36px;
    height: 32px;
    padding: 0;
    border-radius: 7px;
    color: var(--muted);
  }
  .window-controls .ant-btn:hover {
    color: #e9e9ef;
    background: rgba(255, 255, 255, 0.08);
  }
  .window-controls .window-close:hover {
    color: #fff;
    background: #c5414e;
  }
  .current-room {
    min-width: 0;
    -webkit-app-region: no-drag;
  }
  .current-room .ant-btn {
    height: 30px;
    font-size: 12px;
    padding-inline: 10px;
  }
  .current-room-link.ant-btn {
    min-width: 0;
    max-width: clamp(120px, 22vw, 260px);
  }
  .current-room-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .current-room-exit.ant-btn {
    flex-shrink: 0;
  }
  .connection {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 10px;
    color: #7f8492;
  }
  .connection > span {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #5d6270;
  }
  .connection.online {
    color: #93c6b2;
  }
  .connection.online > span {
    background: #88bc9f;
  }
  .version {
    font-size: 9px;
    color: #4f5563;
  }
  .app-footer {
    margin-top: auto;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 21px 35px;
    color: #484e5c;
    font-size: 8px;
    letter-spacing: 0.6px;
  }
  .app-footer > span:first-child {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .eyebrow {
    font-size: 9px;
    letter-spacing: 2px;
    color: #8c819f;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .eyebrow > span:not(.live-dot) {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #bc9cf5;
  }
  .live-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    display: inline-block;
    background: #b9a3f4;
    box-shadow: 0 0 9px #b9a3f433;
    flex-shrink: 0;
  }
  .welcome {
    display: grid;
    grid-template-columns: 1.15fr 1fr;
    gap: 50px;
    padding: 64px 55px 25px;
    align-items: center;
    max-width: 1200px;
    margin: auto;
    width: 100%;
  }
  .welcome-art {
    position: relative;
    min-height: 590px;
  }
  .welcome-art h1 {
    font-size: 45px;
    font-weight: 500;
    line-height: 1.5;
    margin-top: 24px;
    letter-spacing: -1px;
  }
  .welcome-art h1 span {
    color: #baa4f3;
  }
  .welcome-art > p {
    font-size: 12px;
    line-height: 2;
    color: #7d8191;
    margin-top: 17px;
  }
  .welcome-features {
    display: flex;
    gap: 23px;
    margin-top: 30px;
    font-size: 10px;
    color: #a3a6b4;
  }
  .welcome-features span {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .welcome-card {
    background: linear-gradient(135deg, #1d1e2870, #15171e);
    border: 1px solid #ffffff0b;
    border-radius: 18px;
    padding: 37px 31px;
    max-width: 380px;
    position: relative;
    z-index: 1;
  }
  .card-kicker {
    color: #a994d3;
    font-size: 10px;
    letter-spacing: 1px;
  }
  .welcome-card h2 {
    font-size: 23px;
    font-weight: 500;
    margin: 17px 0 10px;
  }
  .welcome-card > p {
    font-size: 12px;
    color: #7d8191;
    margin-bottom: 30px;
  }
  .muted {
    color: #656a79;
    font-size: 9px;
    line-height: 1.8;
    display: block;
  }
  .welcome-card > .muted {
    margin-top: 16px;
  }
  .welcome-card > .ant-btn-link {
    display: flex;
    justify-content: center;
    width: 100%;
    margin-top: 20px;
  }
  .orbital {
    position: relative;
    height: 230px;
    margin-top: 30px;
    max-width: 370px;
    perspective: 400px;
    overflow: hidden;
  }
  .orbit {
    border: 1px solid #b39bff12;
    position: absolute;
    inset: 30px;
    border-radius: 50%;
    transform: rotateX(50deg) rotateZ(-20deg);
  }
  .orbit.two {
    inset: 0;
    transform: rotateX(50deg) rotateZ(-20deg);
  }
  .orbit.three {
    inset: -30px;
    transform: rotateX(50deg) rotateZ(-20deg);
  }
  .orbit-center {
    position: absolute;
    left: 40%;
    top: 60px;
    transform: rotate(-13deg);
    color: #ad92e7;
    filter: drop-shadow(0 0 28px #a07cff36);
  }
  .orbit-label {
    position: absolute;
    left: 50%;
    bottom: 30px;
    transform: translateX(-50%);
    font-size: 7px;
    letter-spacing: 2px;
    color: #504a63;
    white-space: nowrap;
  }
  .home,
  .room-page {
    padding: 20px 24px;
    flex: 1;
    min-height: 0;
  }
  .page-heading,
  .room-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
  }
  .page-heading h1 {
    font-size: 25px;
    font-weight: 500;
    margin: 13px 0 11px;
    letter-spacing: -0.5px;
  }
  .heading-spark {
    color: #bca5ff;
    font-size: 20px;
    display: inline-block;
    margin-left: 14px;
  }
  .page-heading p {
    color: #757b8a;
    font-size: 11px;
  }
  .home-hero {
    margin-top: 32px;
    border: 1px solid #b39bff10;
    border-radius: 14px;
    background:
      radial-gradient(ellipse at 85% 80%, #4d36542a, transparent 60%),
      linear-gradient(115deg, #24203480, #19182080 62%, #1a1c2460);
    padding: 35px;
    display: flex;
    overflow: hidden;
    position: relative;
    min-height: 315px;
  }
  .home-hero h2 {
    font-weight: 450;
    font-size: 35px;
    line-height: 1.5;
    letter-spacing: 1px;
    margin: 16px 0 11px;
  }
  .home-hero h2 span {
    color: #c2abf2;
  }
  .home-hero p {
    color: #8a849b;
    font-size: 11px;
    line-height: 1.9;
    margin-bottom: 16px;
  }
  .hero-cinema {
    position: relative;
    flex: 1;
    min-width: 240px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    margin-left: 30px;
    transform: translateY(13px);
  }
  .hero-screen {
    width: 85%;
    max-width: 320px;
    height: 175px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 14px;
    border: 1px solid #c1a8f92e;
    box-shadow:
      0 0 55px #aa6ad816,
      inset 0 0 40px #a97fe70a;
    background: linear-gradient(140deg, #39304d, #211d32 60%, #2e2438);
    transform: perspective(600px) rotateY(-12deg) rotateX(6deg);
    position: relative;
  }
  .hero-screen svg {
    color: #a28ab9;
  }
  .hero-screen > span {
    font-size: 8px;
    letter-spacing: 5px;
    color: #8c779c;
  }
  .screen-glow {
    position: absolute;
    inset: 0;
    background: linear-gradient(110deg, transparent, #ffffff03, transparent);
    pointer-events: none;
  }
  .seats {
    display: flex;
    gap: 10px;
    position: relative;
    z-index: 1;
    margin-top: 28px;
    transform: perspective(600px) rotateY(-12deg);
  }
  .seats i {
    display: block;
    width: 45px;
    height: 44px;
    border-radius: 9px 9px 3px 3px;
    background: linear-gradient(#3b3247, #251f2f);
    border-top: 1px solid #b494cc20;
    box-shadow: inset 3px 0 #ffffff03;
  }
  .section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 33px 0 17px;
  }
  .section-heading h2 {
    font-size: 14px;
    font-weight: 500;
  }
  .section-heading h2 > span {
    font-size: 10px;
    color: #777888;
    margin-left: 10px;
  }
  .section-heading > span {
    font-size: 9px;
    color: #5c6271;
  }
  .room-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 16px;
  }
  .room-card {
    border: 1px solid #ffffff0b;
    background: #171920;
    border-radius: 12px;
    overflow: hidden;
    text-align: left;
    min-height: 136px;
  }
  .room-card:hover {
    border-color: #b39bff40;
    transform: translateY(-2px) !important;
  }
  .room-card-top {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .room-card-top > .ant-avatar {
    background: #30283f;
    color: #b6a0d9;
    flex-shrink: 0;
  }
  .room-card-info {
    min-width: 0;
  }
  .room-card-info h3 {
    font-size: 14px;
    font-weight: 500;
    line-height: 22px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .room-card-details {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
  }
  .room-card-details > .ant-tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin: 0;
    font-size: 10px;
    line-height: 18px;
  }
  .room-card-details > span:last-child {
    font-size: 11px;
    letter-spacing: 0.5px;
    color: #858b9a;
  }
  .room-card-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 18px;
  }
  .room-card-footer > span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    color: #858b9a;
  }
  .room-card-footer > .ant-btn {
    flex-shrink: 0;
    padding-inline: 0;
  }
  .new-room {
    background: transparent;
    border-style: dashed;
    color: #898092;
  }
  .home-note {
    margin-top: 27px;
    display: flex;
    align-items: center;
    gap: 12px;
    color: #6e627f;
    padding: 15px 17px;
    border: 1px solid #ffffff06;
    background: #ffffff01;
    border-radius: 9px;
  }
  .home-note strong {
    font-size: 10px;
    font-weight: 400;
    color: #94909e;
  }
  .home-note p > span {
    display: block;
    font-size: 9px;
    color: #5c6170;
    margin-top: 7px;
  }
  .room-title-row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .room-heading h1 {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 25px;
    font-weight: 500;
    margin: 0;
  }
  .room-id {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    color: #606775;
    font-size: 11px;
    letter-spacing: 1px;
    padding: 0;
    flex-shrink: 0;
  }
  .heading-actions {
    display: flex;
    align-items: center;
    gap: 13px;
    flex-shrink: 0;
  }
  .room-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 250px;
    gap: 16px;
    margin-top: 16px;
    flex: 1;
    min-height: 0;
    grid-template-rows: minmax(0, 1fr);
  }
  .audio-compatibility-alert.ant-alert {
    flex-shrink: 0;
    margin-top: 12px;
  }
  .capture-audio-compatibility.ant-alert {
    margin-top: 12px;
  }
  .room-slot,
  .room-page,
  .view-column {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .room-slot {
    flex: 1;
  }
  .room-heading {
    flex-shrink: 0;
  }
  .stage {
    width: 100%;
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
    border: 1px solid #ffffff0b;
    border-radius: 12px;
    background:
      radial-gradient(ellipse at 50% 32%, #29223750, transparent 60%), #101116;
  }
  .stage > video {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: none;
    background: #08090c;
  }
  .stage.has-video > video {
    display: block;
  }
  .stage > .local-share-preview:not([hidden]) {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #08090c;
  }
  .stage-empty {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
  }
  .stage-icon {
    position: relative;
    color: #b19acb;
    margin-bottom: 12px;
  }
  .stage-icon > svg {
    filter: drop-shadow(0 0 23px #ac84df35);
  }
  .sparkle {
    position: absolute;
    top: -5px;
    right: -14px;
    font-size: 15px;
    color: #dac38e;
  }
  .stage-empty > .eyebrow {
    font-size: 7px;
    letter-spacing: 2px;
    color: #746482;
  }
  .stage-empty h2 {
    font-size: 22px;
    font-weight: 450;
    letter-spacing: 1px;
    margin: 12px 0;
  }
  .stage-join h2 {
    max-width: 90%;
    text-align: center;
    overflow-wrap: anywhere;
  }
  .stage-empty p {
    font-size: 10px;
    color: #6c7180;
    margin-bottom: 12px;
  }
  .stage-empty .ant-btn-primary {
    padding: 11px 17px;
    font-size: 10px;
  }
  .stage-hint {
    color: #454b5a;
    font-size: 8px;
    margin-top: 13px;
  }
  .stage-view-controls {
    position: absolute;
    bottom: 12px;
    right: 12px;
    z-index: 3;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .stage-action.ant-btn {
    width: 36px;
    height: 36px;
    padding: 0;
    border: 0;
    border-radius: 8px;
    background: #090b1040;
    color: #757d90;
  }
  .video-label {
    position: absolute;
    left: 13px;
    top: 13px;
    display: flex;
    align-items: center;
    gap: 7px;
    background: #101116c9;
    padding: 7px 9px;
    border-radius: 5px;
    font-size: 9px;
  }
  .video-label > span:last-child:not(.live-dot) {
    display: flex;
    align-items: center;
    gap: 5px;
    color: #9693a5;
    margin-left: 8px;
  }
  .stage-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 10px 0;
    flex-shrink: 0;
    color: #646c7c;
    font-size: 9px;
  }
  .stage-meta > span {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .quality-label {
    margin-left: 8px;
    padding-left: 12px;
    border-left: 1px solid #343b49;
  }
  .mixer-card {
    border: 1px solid #ffffff0b;
    border-radius: 10px;
    background: #15171e;
    display: flex;
    align-items: center;
    padding: 10px 14px;
    flex-shrink: 0;
    gap: 20px;
  }
  .volume {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .volume > span {
    font-size: 9px;
    color: #8f94a4;
    display: flex;
    align-items: center;
    gap: 8px;
    white-space: nowrap;
  }
  .volume > input {
    flex: 1;
  }
  .volume > small {
    font-size: 8px;
    color: #6d7383;
    min-width: 25px;
  }
  .mixer-divider {
    height: 23px;
    width: 1px;
    background: var(--line);
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 15px;
    margin-top: 10px;
    padding: 8px 12px;
    flex-shrink: 0;
    border: 1px solid #ffffff0b;
    border-radius: 12px;
    background: #181a22;
  }
  .control-group {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .control-button.ant-btn {
    height: auto;
    min-height: 58px;
    flex-direction: column;
    gap: 7px;
    padding: 6px 8px;
  }
  .control-button.ant-btn > span {
    font-size: 10px;
    white-space: nowrap;
  }
  .control-button.muted-control {
    color: #bd8d90;
  }
  .control-button.sharing-control {
    color: #c4adff;
  }
  .control-divider {
    height: 30px;
    width: 1px;
    background: var(--line);
    margin: 0 2px;
  }
  .control-settings {
    padding: 4px;
    align-self: flex-start;
    margin-top: 3px;
  }
  .control-spacer {
    flex: 1;
  }
  .room-panel {
    border: 1px solid #ffffff0b;
    border-radius: 12px;
    background: #13151b;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }
  .members-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 12px;
  }
  .member {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr) auto;
    align-items: start;
    column-gap: 12px;
    padding: 12px 1px;
  }
  .member.speaking > .ant-avatar {
    box-shadow:
      0 0 0 2px #a690d7,
      0 0 18px #9977dd16;
  }
  .member-main {
    flex: 1;
    min-width: 0;
    padding-top: 2px;
  }
  .member-main strong {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    font-weight: 500;
  }
  .member-main > small {
    display: block;
    color: #5c6574;
    font-size: 11px;
    margin-top: 7px;
  }
  .member-name {
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .member-status {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .member-status .member-quality,
  .member-status .member-mic {
    display: flex;
    padding-top: 0;
  }
  .member-menu-trigger.ant-btn {
    width: 24px;
    min-width: 24px;
    height: 24px;
    padding: 0;
    color: #9298a9;
  }
  .member-mic {
    color: #9b9aaf;
    padding-top: 5px;
  }
  .member-mic.off {
    color: #4c5261;
  }
  .danger {
    color: #c4878c;
  }
  .panel-note {
    display: flex;
    align-items: center;
    flex-direction: column;
    margin: auto 17px 24px;
    color: #514b62;
    text-align: center;
    padding-top: 35px;
  }
  .panel-note strong {
    font-size: 9px;
    font-weight: 400;
    color: #737081;
    margin-top: 14px;
  }
  .panel-note p {
    font-size: 8px;
    line-height: 1.9;
    color: #4e5563;
    margin-top: 9px;
  }
  .ban-link {
    font-size: 8px;
    justify-content: center;
    margin-bottom: 15px;
    color: #606574;
  }
  .audio-unlock {
    width: 100%;
    margin-top: 15px;
  }
  .chat {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .chat-tab-label {
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }
  .chat-new-messages {
    align-self: center;
    flex-shrink: 0;
    margin: 6px 0;
  }
  .chat-notification p {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .chat-messages {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 18px 15px;
  }
  .chat-empty {
    height: 100%;
    margin: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #4c4a61;
  }
  .chat-empty p {
    font-size: 10px;
    color: #62687a;
    line-height: 1.9;
    text-align: center;
    margin-top: 17px;
  }
  .chat-message {
    margin-bottom: 19px;
  }
  .chat-message > header {
    display: flex;
    align-items: center;
    gap: 9px;
    font-size: 9px;
    color: #9395a6;
  }
  .chat-message strong {
    font-weight: 500;
  }
  .chat-message time {
    font-size: 8px;
    color: #4d5668;
  }
  .chat-message p {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 10px;
    line-height: 1.8;
    color: #b6b7c4;
    margin-top: 7px;
    background: #ffffff03;
    padding: 9px 10px;
    border-radius: 0 8px 8px 8px;
  }
  .chat-compose {
    display: flex;
    align-items: center;
    padding: 12px;
    flex-shrink: 0;
    border-top: 1px solid var(--line);
    gap: 4px;
  }
  .chat-compose > input {
    font-size: 10px;
    padding: 10px 8px;
    border: 0;
    background: transparent;
  }
  &.cinema > .sidebar {
    display: none;
  }
  &.cinema > .workspace {
    margin-left: 0;
    width: 100%;
  }
  &.cinema .room-layout {
    grid-template-columns: 1fr;
  }
  &.cinema .room-panel,
  &.cinema .topbar,
  &.cinema .app-footer {
    display: none;
  }
  &.cinema .room-page {
    padding: 20px 28px;
  }
  &.cinema .stage {
    min-height: 0;
    aspect-ratio: auto;
  }
  &.cinema .room-heading {
    margin-bottom: 10px;
  }
  .stage:fullscreen {
    border: 0;
    border-radius: 0;
    aspect-ratio: auto;
    width: 100vw;
    height: 100vh;
    background: #000;
  }
  .stage:fullscreen > video {
    object-fit: contain;
  }
  .stage:fullscreen > .stage-view-controls {
    position: absolute;
    bottom: 25px;
    right: 25px;
  }
  @media (min-width: 1550px) {
    .home,
    .room-page {
      padding: 20px 32px;
    }
    .room-layout {
      grid-template-columns: minmax(0, 1fr) 290px;
      gap: 27px;
    }
    .home-hero {
      min-height: 360px;
      padding: 40px;
    }
    .home-hero h2 {
      font-size: 43px;
    }
    .hero-screen {
      height: 205px;
      max-width: 380px;
    }
  }
  @media (max-width: 1150px) {
    .sidebar {
      width: 188px;
      padding-left: 10px;
      padding-right: 10px;
    }
    .workspace {
      margin-left: 188px;
      width: calc(100% - 188px);
    }
    .home,
    .room-page {
      padding: 20px;
    }
    .topbar {
      padding: 0 25px;
    }
    .room-layout {
      grid-template-columns: minmax(0, 1fr) 220px;
      gap: 15px;
    }
    .controls {
      gap: 6px;
      padding: 8px 10px;
    }
    .control-button {
      padding: 5px;
    }
    .mixer-card {
      padding: 10px;
      gap: 12px;
    }
    .volume {
      gap: 8px;
    }

    .volume > span > svg {
      width: 14px;
    }
    .room-heading h1 {
      font-size: 22px;
    }
    .welcome {
      padding: 40px 30px;
      gap: 25px;
    }
    .welcome-art h1 {
      font-size: 34px;
    }
    .welcome-card {
      padding: 27px 23px;
    }
    .hero-cinema {
      min-width: 190px;
      margin-left: 10px;
    }
    .hero-screen {
      height: 145px;
    }
    .seats {
      gap: 7px;
    }
    .seats i {
      width: 32px;
      height: 32px;
    }
    .home-hero {
      padding: 27px;
    }
    .home-hero h2 {
      font-size: 30px;
    }
  }
  @media (max-width: 950px) {
    .sidebar {
      width: 170px;
    }
    .workspace {
      margin-left: 170px;
      width: calc(100% - 170px);
    }
    .room-layout {
      grid-template-columns: minmax(0, 1fr);
    }
    .room-panel {
      min-height: 250px;
    }
    .members-list {
      display: flex;
      flex-wrap: wrap;
      gap: 15px;
    }
    .member {
      min-width: 170px;
    }
    .panel-note,
    .ban-link {
      display: none;
    }
    .room-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .welcome {
      grid-template-columns: 1fr;
      padding: 35px;
      max-width: 600px;
    }
    .welcome-art {
      min-height: 0;
    }
    .welcome-art h1 {
      font-size: 33px;
    }
    .welcome-art .orbital {
      display: none;
    }
    .welcome-card {
      max-width: none;
    }
    .hero-cinema {
      display: none;
    }
    .home-hero {
      min-height: 290px;
    }
    .section-heading > span {
      display: none;
    }
    .dialog {
      max-width: calc(100vw - 40px);
    }
    .app-footer {
      font-size: 7px;
      padding: 15px 25px;
    }
  }
  .home {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .home .page-heading {
    flex-shrink: 0;
  }
  .home-hero {
    min-height: 0;
    flex-shrink: 0;
    margin-top: 20px;
    padding: 20px 28px;
  }
  .home-hero h2 {
    font-size: 28px;
    margin: 8px 0;
  }
  .home-hero p {
    margin-bottom: 14px;
  }
  .hero-screen {
    height: 125px;
  }
  .seats {
    margin-top: 16px;
  }
  .section-heading {
    flex-shrink: 0;
    margin: 20px 0 12px;
  }
  .room-grid {
    min-height: 0;
    overflow-y: auto;
    padding: 2px;
  }
  .room-card,
  .new-room {
    min-height: 136px;
  }
  .home-note {
    display: none;
  }
  .welcome {
    min-height: 0;
    padding: 24px 32px;
  }
  .welcome-art {
    min-height: 0;
  }
  .orbital {
    height: clamp(100px, 22vh, 230px);
  }
  .shortcut-recorder.ant-btn {
    width: 100%;
    justify-content: space-between;
  }
  .shortcut-recorder.recording {
    border-color: var(--accent);
    color: var(--accent);
  }
  .settings-tabs .ant-form-item {
    margin-bottom: 18px;
  }
  .settings-tabs .ant-form-item:last-child {
    margin-bottom: 0;
  }
  .ban-link {
    flex-shrink: 0;
    margin: 8px 12px 12px;
  }
  @media (max-height: 760px) {
    .sidebar {
      padding-top: 36px;
    }
    .brand {
      margin-bottom: 24px;
    }
    .room-label {
      margin-top: 20px;
    }
    .sidebar-bottom {
      padding-top: 12px;
    }
    .profile {
      margin-top: 8px;
      padding: 12px 1px;
    }
    .room-page .eyebrow {
      display: none;
    }
    .stage-icon {
      margin-bottom: 8px;
    }
    .stage-empty h2 {
      margin: 4px 0 8px;
      font-size: 20px;
    }
    .stage-empty p {
      margin-bottom: 12px;
    }
    .stage-hint {
      margin-top: 8px;
    }
    .home-hero {
      padding: 16px 24px;
    }
    .home-hero h2 {
      font-size: 23px;
    }
    .home-hero p br {
      display: none;
    }
    .welcome-art .orbital {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    * {
      transition: none !important;
      scroll-behavior: auto !important;
    }
  }
  ::-webkit-scrollbar {
    width: 5px;
    height: 5px;
  }
  ::-webkit-scrollbar-thumb {
    background: #3a384e;
    border-radius: 5px;
  }
  ::-webkit-scrollbar-track {
    background: transparent;
  }

  .network-warning {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 9px;
    color: #d0ad7b;
  }
  .member-quality {
    padding-top: 6px;
    color: #576c61;
  }
  .member-quality.poor {
    color: #c9a270;
  }

  [hidden] {
    display: none !important;
  }
  .sidebar-menu.ant-menu {
    background: transparent;
    border-inline-end: 0;
  }
  .sidebar-menu .ant-menu-item {
    margin-inline: 0;
    width: 100%;
    padding-inline: 12px !important;
  }
  .sidebar-menu .ant-menu-title-content {
    font-size: 12px;
  }
  .sidebar-menu .ant-badge {
    margin-left: 6px;
  }
  .room-menu .ant-menu-item {
    height: 48px;
  }
  .room-menu .ant-avatar {
    background: #252032;
    color: #b6a0d9;
  }
  .profile > .ant-avatar {
    flex-shrink: 0;
  }
  .room-card .ant-card-body {
    padding: 16px;
  }
  .new-room .ant-card-body {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 16px;
    min-height: 134px;
  }
  .welcome-card .ant-form-item {
    margin: 0 0 12px;
  }
  .welcome-card {
    padding: 20px 24px;
  }
  .welcome-card h2 {
    margin: 0 0 12px;
  }
  .welcome-card .ant-form-item-label {
    padding-bottom: 4px;
  }
  .account-identity {
    margin-bottom: 16px;
    color: #9298a9;
    font-size: 12px;
  }
  .welcome-card .ant-btn-link {
    margin: 15px auto 0;
    display: flex;
  }
  .room-title-row > .ant-tag {
    font-size: 11px;
    font-weight: 400;
    margin: 0;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
  }
  .room-tabs {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .room-tabs > .ant-tabs-body-holder {
    display: flex;
    flex: 1;
    min-height: 0;
  }
  .room-tab-body {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .room-tab-content {
    flex: 1;
    min-height: 0;
  }
  .room-tab-content[aria-hidden="false"] {
    display: flex;
    flex-direction: column;
  }
  .room-tabs > .ant-tabs-nav {
    padding: 0 16px;
    margin: 0;
  }
  .room-tabs .ant-tabs-tab-btn {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .room-tabs .ant-tabs-tab-icon {
    display: flex;
    margin-inline-end: 0;
  }
  .room-tabs .ant-tabs-tab {
    font-size: 12px;
  }
  .room-tabs .ant-tabs-tab + .ant-tabs-tab {
    margin-left: 20px;
  }
  .member-main strong {
    flex-wrap: wrap;
    font-size: 12px;
  }
  .member-main .ant-tag {
    margin: 0;
    font-size: 10px;
    line-height: 18px;
    padding: 0 4px;
  }
  .member > .ant-avatar {
    width: 40px;
    height: 40px;
    flex-shrink: 0;
  }
  .volume .ant-slider {
    flex: 1;
    min-width: 20px;
    margin: 0 6px;
  }
  .volume > span {
    font-size: 11px;
  }
  .volume > small {
    font-size: 10px;
  }
  .share-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .sharing-banner,
  .reconnect-banner {
    margin-top: 12px;
  }
  .chat-compose .ant-input {
    min-width: 0;
  }
  .chat-empty .ant-empty-image {
    height: 32px;
  }
  .cinema-dialog .ant-modal-container {
    display: flex;
    flex-direction: column;
    max-height: calc(100dvh - 48px);
    padding: 24px;
  }
  .cinema-dialog .ant-modal-header {
    flex-shrink: 0;
    padding-right: 28px;
    margin-bottom: 16px;
  }
  .cinema-dialog .ant-modal-body {
    min-height: 0;
    overflow-y: auto;
    scrollbar-gutter: stable;
  }
  .cinema-dialog .ant-modal-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    flex-shrink: 0;
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid var(--line);
  }
  .cinema-dialog .ant-modal-footer > .ant-btn + .ant-btn {
    margin-inline-start: 0;
  }
  .dialog-header h2 {
    font-size: 21px;
    line-height: 1.5;
    font-weight: 600;
  }
  .dialog-header p {
    font-size: 13px;
    font-weight: 400;
    color: #9298a9;
    line-height: 1.7;
    margin-top: 10px;
  }
  .dialog-inner {
    padding: 0 2px 2px;
  }
  .form-note,
  .field-help {
    color: #9298a9;
    font-size: 12px;
    line-height: 1.8;
  }
  .form-note {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-top: 16px;
  }
  .form-note > svg {
    margin-top: 3px;
  }
  .field-help {
    margin: 6px 0 16px 24px;
  }
  .source-grid.ant-radio-group {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
    max-height: min(280px, calc(100dvh - 300px));
    overflow-y: auto;
    padding: 3px;
  }
  .source-card.ant-radio-wrapper {
    display: block;
    position: relative;
    margin: 0;
    min-width: 0;
    align-self: start;
  }
  .source-card > .ant-radio {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 1;
  }
  .source-card > span:last-child {
    display: block;
    padding: 0;
  }
  .source-option.ant-card {
    overflow: hidden;
    background: #151820;
  }
  .source-option .ant-card-body {
    padding: 12px;
  }
  .source-card.ant-radio-wrapper-checked .source-option {
    border-color: #bca5ff;
    box-shadow: 0 0 0 2px #bca5ff20;
  }
  .source-card:focus-within .source-option {
    outline: 2px solid #bca5ff;
    outline-offset: 2px;
  }
  .source-preview {
    width: 100%;
    aspect-ratio: 16 / 9;
    background: #0e111a;
  }
  .source-preview > img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .source-placeholder {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: #a7b2d0;
  }
  .source-name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 13px;
  }
  .capture-tabs .ant-tabs-tab-btn {
    display: flex;
    align-items: center;
  }
  .capture-tabs .ant-tabs-tab-icon {
    display: flex;
  }
  .capture-audio {
    margin-top: 16px;
  }
  .capture-audio .ant-select {
    width: 100%;
  }
  .device-test {
    display: flex;
    align-items: center;
    gap: 18px;
    margin: -8px 0 24px;
  }
  .device-test > .ant-progress {
    flex: 1;
  }
  .shortcut-fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px;
  }
  .shortcut-fields.single-shortcut {
    grid-template-columns: minmax(0, 1fr);
  }
  .invite-note {
    margin-top: 20px;
  }
  .friends-list {
    margin-top: 16px;
  }
  .friend {
    display: flex;
    align-items: center;
    gap: 10px;
    border-bottom: 1px solid var(--line);
    padding: 16px 0;
  }
  .friend > span:not(.ant-avatar) {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .room-invitation-list {
    max-height: min(400px, calc(100dvh - 240px));
    overflow: auto;
  }
  .room-invitation-list .ant-list-item {
    align-items: center;
    gap: 12px;
  }
  .room-invitation-list .ant-list-item-meta {
    min-width: 0;
    align-items: center;
  }
  .room-invitation-list .ant-list-item-meta-title,
  .room-invitation-list .ant-list-item-meta-description {
    overflow-wrap: anywhere;
  }
  .room-invitation-list .ant-list-item-action {
    flex-shrink: 0;
    margin-inline-start: 8px;
  }
  .friend .ant-avatar {
    flex-shrink: 0;
  }
  .friend small {
    display: block;
    color: #9298a9;
    font-size: 12px;
    margin-top: 5px;
  }
  .diagnostic-overview {
    margin-bottom: 16px;
  }
  .diagnostic-status-card .ant-descriptions-item-label {
    width: 100px;
    color: #c4c7d2;
  }
  .diagnostic-status-card .ant-typography {
    font-size: 12px;
  }
  .diagnostic-status-card .ant-tag {
    margin: 0;
  }
  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 22px;
  }
  @media (max-width: 1050px) {
    .control-button.ant-btn {
      padding: 5px;
    }
  }
  @media (max-width: 1100px) {
    .welcome {
      grid-template-columns: minmax(0, 1fr) minmax(280px, 340px);
      gap: 24px;
      padding: 16px 24px;
    }
    .welcome-art h1 {
      font-size: 28px;
    }
    .welcome-features {
      flex-wrap: wrap;
      gap: 12px;
    }
    .welcome-card {
      padding: 18px 20px;
    }
  }
`;
