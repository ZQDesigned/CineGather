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
    min-height: 100vh;
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
  .brand small {
    display: block;
    font-size: 8px;
    font-weight: 500;
    letter-spacing: 2.5px;
    color: #8f91a0;
    margin-top: 4px;
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
  .privacy-note {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px 12px 20px;
    color: #797d8b;
    font-size: 10px;
  }
  .privacy-note svg {
    color: #9284b0;
  }
  .privacy-note small {
    display: block;
    font-size: 9px;
    color: #515764;
    margin-top: 6px;
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
  .profile > span:not(.ant-avatar) {
    flex: 1;
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
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  .topbar {
    height: 78px;
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
    padding: 35px;
    flex: 1;
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
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-size: 9px;
    color: #b09ec9;
    background: #bc9fff09;
    border: 1px solid #bc9fff13;
    padding: 6px 9px;
    border-radius: 30px;
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
    margin-bottom: 22px;
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
  .hero-caption {
    font-size: 7px;
    letter-spacing: 2px;
    color: #635568;
    margin-top: 19px;
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
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
  }
  .room-card {
    border: 1px solid #ffffff0b;
    background: #171920;
    border-radius: 12px;
    overflow: hidden;
    text-align: left;
    min-height: 190px;
  }
  .room-card:hover {
    border-color: #b39bff40;
    transform: translateY(-2px) !important;
  }
  .room-card-art {
    height: 115px;
    background:
      radial-gradient(ellipse at center, #51415b60, transparent), #25212f;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    color: #a991c2;
  }
  .room-card-art > span {
    position: absolute;
    top: 12px;
    left: 12px;
    border-radius: 4px;
    font-size: 8px;
    padding: 4px 6px;
    background: #14121b80;
    color: #aa9bbd;
  }
  .room-card-copy {
    padding: 15px;
  }
  .room-card-copy h3 {
    font-size: 12px;
    font-weight: 500;
  }
  .room-card-copy > span {
    display: flex;
    justify-content: space-between;
    font-size: 9px;
    color: #6c7282;
    margin-top: 10px;
  }
  .new-room {
    background: transparent;
    border-style: dashed;
    color: #898092;
    min-height: 195px;
  }
  .new-plus {
    display: grid;
    place-items: center;
    background: #24202f;
    border: 1px solid #b39bff13;
    border-radius: 10px;
    width: 39px;
    height: 39px;
    color: #a78dd0;
  }
  .new-room h3 {
    font-size: 11px;
    font-weight: 400;
    margin-top: 17px;
    color: #a5a3b4;
  }
  .new-room p {
    font-size: 9px;
    color: #5c6272;
    margin-top: 9px;
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
  .room-heading h1 {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 25px;
    font-weight: 500;
    margin-top: 12px;
  }
  .room-id {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    color: #606775;
    font-size: 9px;
    letter-spacing: 1px;
    padding: 0;
    margin-top: 12px;
  }
  .heading-actions {
    display: flex;
    align-items: center;
    gap: 13px;
  }
  .room-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 250px;
    gap: 22px;
    margin-top: 27px;
  }
  .view-column {
    min-width: 0;
  }
  .stage {
    width: 100%;
    aspect-ratio: 16/9;
    position: relative;
    overflow: hidden;
    border: 1px solid #ffffff0b;
    border-radius: 12px;
    background:
      radial-gradient(ellipse at 50% 32%, #29223750, transparent 60%), #101116;
    min-height: 270px;
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
    margin-bottom: 23px;
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
  .stage-empty p {
    font-size: 10px;
    color: #6c7180;
    margin-bottom: 23px;
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
  .stage-fullscreen {
    position: absolute;
    bottom: 12px;
    right: 12px;
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
    margin: 14px 0 23px;
    color: #646c7c;
    font-size: 9px;
  }
  .stage-meta > span {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .meta-dot {
    padding: 0 3px;
    color: #343b49;
  }
  .mixer-card {
    border: 1px solid #ffffff0b;
    border-radius: 10px;
    background: #15171e;
    display: flex;
    align-items: center;
    padding: 18px 20px;
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
    margin-top: 22px;
    padding: 17px 19px;
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
    min-height: 510px;
    overflow: hidden;
  }
  .members-list {
    padding: 12px;
  }
  .member {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    padding: 12px 1px;
    flex-wrap: wrap;
  }
  .member.speaking > .ant-avatar {
    box-shadow:
      0 0 0 2px #a690d7,
      0 0 18px #9977dd16;
  }
  .member-main {
    flex: 1;
    min-width: 80px;
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
  .member-main > input {
    width: 80%;
    margin-top: 10px;
    height: 3px;
  }
  .member-mic {
    color: #9b9aaf;
    padding-top: 5px;
  }
  .member-mic.off {
    color: #4c5261;
  }
  .member-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    width: 100%;
    gap: 9px;
    margin-top: -4px;
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
    min-height: 440px;
    max-height: 620px;
  }
  .chat-messages {
    flex: 1;
    overflow: auto;
    padding: 18px 15px;
  }
  .chat-empty {
    height: 100%;
    min-height: 300px;
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
    max-height: calc(100vh - 265px);
    aspect-ratio: auto;
    height: 65vh;
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
  .stage:fullscreen > .stage-fullscreen {
    position: absolute;
    bottom: 25px;
    right: 25px;
  }
  @media (min-width: 1550px) {
    .home,
    .room-page {
      padding: 40px 50px;
    }
    .room-layout {
      grid-template-columns: minmax(0, 1fr) 290px;
      gap: 27px;
    }
    .stage {
      min-height: 380px;
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
      padding: 25px;
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
      padding: 14px 11px;
    }
    .control-button {
      padding: 5px;
    }
    .mixer-card {
      padding: 16px 13px;
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
    padding: 0;
  }
  .room-card-copy {
    position: relative;
    padding-bottom: 55px;
  }
  .room-card-copy > .ant-btn {
    position: absolute;
    right: 8px;
    bottom: 8px;
  }
  .new-room .ant-card-body {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 20px;
  }
  .new-room .ant-btn {
    margin-top: 16px;
  }
  .welcome-card .ant-form-item {
    margin: 24px 0 20px;
  }
  .welcome-card .ant-btn-link {
    margin: 15px auto 0;
    display: flex;
  }
  .room-heading h1 > .ant-tag {
    font-size: 11px;
    font-weight: 400;
    margin: 0;
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .room-tabs {
    flex: 1;
    min-width: 0;
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
  .member-main > .ant-slider {
    width: 100%;
    margin: 8px 0 0;
  }
  .member > .ant-avatar {
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
    padding: 28px;
  }
  .cinema-dialog .ant-modal-header {
    flex-shrink: 0;
    padding-right: 28px;
    margin-bottom: 22px;
  }
  .cinema-dialog .ant-modal-body {
    min-height: 0;
    overflow-y: auto;
    scrollbar-gutter: stable;
  }
  .cinema-dialog .ant-modal-footer {
    flex-shrink: 0;
    margin-top: 22px;
    padding-top: 16px;
    border-top: 1px solid var(--line);
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
    max-height: 310px;
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
    margin-top: 22px;
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
  .identity-card {
    margin-bottom: 24px;
  }
  .identity-card .ant-card-body {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  .identity-card .ant-typography code {
    font-size: 11px;
    overflow-wrap: anywhere;
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
  .diagnostic-cards {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 20px;
  }
  .diagnostic-cards .ant-statistic-content {
    font-size: 21px;
  }
  .diagnostic-json {
    margin: 0;
    max-height: 280px;
    overflow: auto;
    font-size: 11px;
    line-height: 1.8;
    color: #9298a9;
  }
  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 22px;
  }
  @media (max-width: 1050px) {
    .controls {
      flex-wrap: wrap;
    }
    .control-button.ant-btn {
      padding: 5px;
    }
  }
`;
