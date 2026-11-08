import styled from "@emotion/styled";

export const ActivityVolumePanel = styled.div`
  width: 280px;
  max-width: calc(100vw - 48px);
  display: flex;
  flex-direction: column;
  gap: 14px;
  .volume {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .volume > span {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
    white-space: nowrap;
  }
  .ant-slider {
    flex: 1;
    min-width: 65px;
  }
  small {
    min-width: 30px;
    color: var(--muted);
    font-size: 11px;
  }
`;

// Deliberately scoped to the ordinary Room root. Global navigation, esports,
// sharing-only rooms and the history viewer keep their existing styles.
export const RoomActivityLayout = styled.div`
  &.activity-workspace {
    padding-top: 14px;
    padding-bottom: 14px;
    .room-heading {
      gap: 12px;
      min-height: 34px;
    }
    .room-heading h1 {
      font-size: 20px;
    }
    .heading-actions {
      gap: 8px;
    }
    .heading-actions > .ant-btn {
      height: 34px;
      padding-inline: 10px;
    }
    .activity-heading-toolbar {
      display: flex;
      align-items: center;
    }
    .room-activity-controls {
      margin: 0;
      flex-wrap: nowrap;
      gap: 8px;
    }
    .room-activity-controls .ant-btn {
      height: 34px;
    }
    .room-activity-controls small {
      max-width: 130px;
      font-size: 11px;
    }
    .room-panel {
      min-height: 0;
    }
    .members-list {
      display: block;
    }
    .room-layout {
      margin-top: 12px;
      gap: 14px;
    }
    .view-column:has(> .room-activity-stage[data-active="true"]) {
      overflow-y: auto;
      scrollbar-gutter: auto;
      gap: 10px;
    }
    .room-activity-stage {
      flex: 1 0 280px;
      min-height: 280px;
      margin: 0;
      border-radius: 12px;
    }
    .room-activity-stage > header {
      min-height: 44px;
      padding: 6px 12px;
      gap: 8px;
      flex-wrap: wrap;
    }
    .room-activity-stage > header > strong {
      flex: 0 1 auto;
      font-size: 12px;
    }
    .room-activity-stage > header > span {
      font-size: 11px;
    }
    .room-activity-stage > header > .ant-btn {
      margin-left: auto;
    }
    .room-activity-stage > header .ant-tag {
      margin-inline-end: 0;
    }
    .party-status {
      flex: 1 1 auto;
      min-height: 0;
      padding: 0;
      gap: 8px;
      font-size: 12px;
    }
    .party-status > .ant-btn {
      height: 28px;
      font-size: 11px;
      padding-inline: 9px;
    }
    .party-status > strong,
    .party-status > span {
      margin-left: auto;
    }
    .party-choices {
      margin-left: auto;
      gap: 6px;
    }
    .party-choices > .ant-btn {
      min-height: 28px;
      height: auto;
      padding: 4px 9px;
      white-space: normal;
      font-size: 12px;
    }
    .activity-board-content,
    .activity-board-content > .collab-board {
      flex: 1 1 0;
      min-height: 160px;
    }
    .collab-board.workspace-board {
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr);
      grid-template-rows: minmax(160px, 1fr);
      gap: 10px;
      padding: 10px;
    }
    .workspace-board .collab-canvas {
      grid-column: 2;
      grid-row: 1;
      width: 100%;
      height: 100%;
      min-height: 160px;
      min-width: 0;
      background: #0f1116;
      border-radius: 5px;
    }
    .workspace-board:not(:has(> .collab-tools)) {
      grid-template-columns: minmax(0, 1fr);
    }
    .workspace-board:not(:has(> .collab-tools)) .collab-canvas {
      grid-column: 1;
    }
    .workspace-board .collab-tools {
      grid-column: 1;
      grid-row: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      flex-wrap: nowrap;
      gap: 5px;
      padding: 5px 3px;
      border: 1px solid #ffffff0b;
      border-radius: 9px;
      background: #1a1c25;
      min-height: 0;
      overflow-y: auto;
      scrollbar-width: thin;
      align-self: start;
      max-height: 100%;
    }
    .workspace-board .collab-tools .ant-btn {
      width: 32px;
      min-height: 32px;
      height: 32px;
      padding: 0;
      flex-shrink: 0;
      border-radius: 7px;
    }
    .workspace-board .collab-import {
      display: contents;
    }
    .workspace-board .collab-import .ant-btn {
      width: 32px;
      min-height: 32px;
      height: 32px;
      padding: 0;
    }
    .workspace-board .collab-import .ant-btn > span {
      display: none;
    }
    .party-answer {
      padding: 0 12px 10px;
      gap: 8px;
    }
    .party-answer .ant-input {
      min-width: 0;
    }
    .party-answer .ant-btn {
      height: 34px;
    }
    .activity-member-entry > .activity-member-status {
      margin: -6px 0 8px 53px;
      font-size: 10px;
      color: #bca5e7;
    }
    .controls {
      margin-top: 0;
      padding: 7px 10px;
      gap: 9px;
      min-height: 52px;
    }
    .controls .control-button.ant-btn {
      min-height: 34px;
      height: 34px;
      flex-direction: row;
      gap: 7px;
      padding: 4px 8px;
    }
    .controls .control-button svg {
      width: 17px;
      height: 17px;
    }
    .controls .control-button.ant-btn > span {
      font-size: 11px;
    }
    .controls .control-divider {
      height: 23px;
    }
    .controls .audio-quick-trigger.ant-btn {
      height: 34px;
    }
    .controls .leave-button.ant-btn {
      height: 34px;
      padding-inline: 10px;
    }
    .activity-volume-trigger {
      height: 34px;
      font-size: 11px;
    }
  }
  &.activity-workspace.activity-panel-collapsed .room-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  &.activity-workspace.activity-panel-collapsed .room-panel {
    display: none;
  }
  &.activity-workspace.activity-focus {
    padding: 10px 14px;
  }
  @media (max-width: 1100px) {
    &.activity-workspace {
      .room-heading {
        flex-wrap: wrap;
        gap: 8px;
      }
      .room-heading h1 {
        font-size: 18px;
      }
      .heading-actions {
        margin-left: auto;
      }
      .controls {
        gap: 5px;
        padding-inline: 7px;
      }
      .controls .control-button.ant-btn {
        gap: 5px;
        padding-inline: 5px;
      }
      .controls .control-button.ant-btn > span {
        font-size: 10px;
      }
    }
  }
  @media (max-width: 1050px) {
    &.activity-workspace {
      .room-layout {
        grid-template-columns: minmax(0, 1fr);
      }
      .room-panel {
        display: none;
      }
      &.activity-panel-expanded .room-layout {
        grid-template-columns: minmax(0, 1fr) 220px;
      }
      &.activity-panel-expanded .room-panel {
        display: flex;
      }
    }
  }
`;
