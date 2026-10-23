import { Avatar, Button, Dropdown, Slider, Tag, type MenuProps } from "antd";
import { useRef, useState } from "react";
import styled from "@emotion/styled";
import {
  Ellipsis,
  LogOut,
  Mic,
  MicOff,
  Signal,
  UserPlus,
  Volume2,
} from "lucide-react";
import type { ParticipantSummary } from "@cinegather/media-core";
import type { RoomInfo } from "@cinegather/contracts";
import { unwrap } from "@cinegather/api-client";
import * as actions from "../controller";
import { update } from "../store";

const MemberPopup = styled.div`
  width: 236px;
  padding: 8px;
  border: 1px solid #ffffff18;
  border-radius: 12px;
  background: #191b24;
  box-shadow: 0 12px 36px #0006;
  .member-menu-heading {
    padding: 6px 10px 12px;
    margin-bottom: 4px;
    color: #e9e9ef;
    font-size: 13px;
    font-weight: 600;
    overflow-wrap: anywhere;
    border-bottom: 1px solid #ffffff0e;
  }
  .member-menu-volume {
    padding: 10px;
  }
  .member-menu-volume-label {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #e9e9ef;
    font-size: 12px;
  }
  .member-volume-value {
    margin-left: auto;
    color: #9298a9;
  }
  .ant-slider {
    margin: 16px 4px 6px;
  }
  .ant-dropdown-menu {
    padding: 4px 0 0;
    background: transparent;
    box-shadow: none;
  }
`;

export function Member({
  participant: p,
  room,
  volume,
  onVolumeChange,
}: {
  participant: ParticipantSummary;
  room: RoomInfo;
  volume: number;
  onVolumeChange(value: number): void;
}) {
  const [open, setOpen] = useState(false);
  const [focusVolume, setFocusVolume] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const items: MenuProps["items"] = [
    { key: "friend", label: "添加好友", icon: <UserPlus size={15} /> },
    ...(room.role === "owner"
      ? [
          { type: "divider" as const },
          {
            key: "remove",
            label: "移出房间",
            danger: true,
            icon: <LogOut size={15} />,
          },
        ]
      : []),
  ];
  const select: MenuProps["onClick"] = ({ key }) => {
    setOpen(false);
    void actions.run(async () => {
      if (key === "friend") {
        unwrap(
          await actions.api.POST("/api/v1/friends", { body: { userId: p.id } }),
        );
        update({ notice: "好友请求已发送" });
      } else if (key === "remove" && room.role === "owner") {
        unwrap(
          await actions.api.DELETE("/api/v1/rooms/{roomId}/members/{userId}", {
            params: { path: { roomId: room.id, userId: p.id } },
            body: { ban: false },
          }),
        );
      }
    });
  };
  const row = (
    <div
      className={`member ${p.speaking ? "speaking" : ""}`}
      onKeyDown={(event) => {
        if (
          !p.local &&
          (event.key === "ContextMenu" ||
            (event.shiftKey && event.key === "F10"))
        ) {
          event.preventDefault();
          setFocusVolume(true);
          setOpen(true);
        }
      }}
    >
      <Avatar className={p.local ? "purple" : "amber"}>{p.name[0]}</Avatar>
      <div className="member-main">
        <strong>
          <span className="member-name" title={p.name}>
            {p.name}
          </span>
          {p.local && <Tag>你</Tag>}
          {p.id === room.ownerUserId && <Tag color="purple">房主</Tag>}
        </strong>
        <small>
          {p.speaking
            ? "正在说话"
            : p.microphone
              ? "语音已就绪"
              : "麦克风已关闭"}
        </small>
      </div>
      <div className="member-status">
        <span
          className={`member-quality ${p.quality === "poor" || p.quality === "lost" ? "poor" : ""}`}
          title={`网络质量：${p.quality === "excellent" ? "优秀" : p.quality === "good" ? "良好" : p.quality === "poor" ? "较差" : p.quality === "lost" ? "已丢失" : "测量中"}`}
        >
          <Signal size={12} />
        </span>
        <span className={`member-mic ${p.microphone ? "" : "off"}`}>
          {p.microphone ? <Mic size={14} /> : <MicOff size={14} />}
        </span>
        {!p.local && (
          <Button
            ref={menuButton}
            type="text"
            size="small"
            className="member-menu-trigger"
            aria-label={`${p.name}的成员操作`}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={(event) => {
              setFocusVolume(event.detail === 0);
              setOpen(!open);
            }}
            icon={<Ellipsis size={16} />}
          />
        )}
      </div>
    </div>
  );
  if (p.local) return row;
  return (
    <Dropdown
      trigger={["contextMenu"]}
      open={open}
      onOpenChange={(nextOpen) => {
        setFocusVolume(false);
        setOpen(nextOpen);
      }}
      destroyOnHidden
      menu={{ items, onClick: select }}
      popupRender={(menu) => (
        <MemberPopup
          className="member-context-popup"
          onKeyDownCapture={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              menuButton.current?.focus();
            } else if (event.key === "Tab") {
              event.preventDefault();
              event.stopPropagation();
              const controls = Array.from(
                event.currentTarget.querySelectorAll<HTMLElement>(
                  '[role="slider"], [role="menuitem"]:not([aria-disabled="true"])',
                ),
              );
              const index = controls.indexOf(
                document.activeElement as HTMLElement,
              );
              controls[
                (index + (event.shiftKey ? -1 : 1) + controls.length) %
                  controls.length
              ]?.focus();
            }
          }}
        >
          <div className="member-menu-heading">{p.name}</div>
          <div className="member-menu-volume">
            <div className="member-menu-volume-label">
              <Volume2 size={15} />
              <span>用户音量</span>
              <span className="member-volume-value" aria-hidden>
                {volume}%
              </span>
            </div>
            <Slider
              autoFocus={focusVolume}
              ariaLabelForHandle={`${p.name}的音量`}
              min={0}
              max={100}
              value={volume}
              onChange={onVolumeChange}
            />
          </div>
          {menu}
        </MemberPopup>
      )}
    >
      {row}
    </Dropdown>
  );
}
