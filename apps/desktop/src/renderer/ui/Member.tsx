import {
  App,
  Avatar,
  Button,
  Dropdown,
  Slider,
  Tooltip,
  Switch,
  Tag,
  type MenuProps,
} from "antd";
import {
  cloneElement,
  isValidElement,
  useRef,
  useState,
  type ReactNode,
  type ReactElement,
  type KeyboardEvent,
} from "react";
import styled from "@emotion/styled";
import {
  Check,
  ChevronRight,
  Clock3,
  Crown,
  MonitorOff,
  Ellipsis,
  LogOut,
  Mic,
  MicOff,
  Music2,
  Square,
  Signal,
  Users,
  UserPlus,
  Volume2,
} from "lucide-react";
import type { ParticipantSummary } from "@cinegather/media-core";
import {
  esportsSeatChoices,
  esportsSeatLimit,
  defaultEsportsConfiguration,
  isTeamSeat,
  type EsportsSeat,
  type RoomInfo,
} from "@cinegather/contracts";
import { unwrap } from "@cinegather/api-client";
import {
  memberManagementActions,
  type MemberManagementAction,
} from "../../shared/member-actions";
import { memberFriendAction } from "@cinegather/client-core";
import * as actions from "../controller";
import { state, update, useApp } from "../store";

const MemberPopup = styled.div`
  width: 236px;
  max-height: calc(100dvh - 16px);
  overflow-y: auto;
  overscroll-behavior: contain;
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
  .ant-dropdown-menu-submenu-title {
    display: flex;
    align-items: center;
  }
  .ant-dropdown-menu-submenu-expand-icon {
    position: absolute;
    inset-inline-end: 12px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    justify-content: center;
    height: 14px;
    line-height: 1;
  }
  .ant-dropdown-menu {
    padding: 4px 0 0;
    background: transparent;
    box-shadow: none;
  }
`;

const MenuToggle = styled.span`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  .ant-switch {
    pointer-events: none;
  }
`;
export function Member({
  participant: p,
  children,
  statusText,
  room,
  volume,
  onVolumeChange,
  onVolumeCommit,
}: {
  participant: ParticipantSummary;
  children?: ReactNode;
  statusText?: string;
  room: RoomInfo;
  volume: number;
  onVolumeChange(value: number): void;
  onVolumeCommit?(value: number): void;
}) {
  const { modal } = App.useApp();
  const sharerId = useApp((s) =>
    s.room?.mode === "esports" &&
    s.esports?.snapshot?.publications.some((pub) => pub.userId === p.id)
      ? p.id
      : s.media.sharer?.id,
  );
  const selfId = useApp((s) => s.user?.id);
  const friendship = useApp((s) => s.friends.find((f) => f.userId === p.id));
  const friendAction = memberFriendAction(selfId, p.id, friendship);
  const [friendBusy, setFriendBusy] = useState(false);
  const friendFlight = useRef(false);
  const esports = useApp((s) => s.esports?.snapshot);
  const esportsMember =
    room.mode === "esports" && esports?.roomId === room.id
      ? esports.members.find((m) => m.userId === p.id)
      : undefined;
  const permission =
    room.memberPermissions?.find((m) => m.userId === p.id) ?? esportsMember;
  const microphoneAllowed = permission?.microphoneAllowed !== false;
  const sharingAllowed = permission?.sharingAllowed !== false;
  const management = memberManagementActions({
    owner: room.role === "owner",
    self: p.id === selfId,
    mode: room.mode,
    seat: esportsMember?.seat,
    sharing: sharerId === p.id,
  });
  const configuration = esports?.configuration ?? defaultEsportsConfiguration;
  const seatChoices = esportsSeatChoices(configuration).map((c) => ({
    ...c,
    key: `seat-${c.key}`,
  }));
  const sameSeat = (a: EsportsSeat, b: EsportsSeat) =>
    a.kind === b.kind &&
    (!isTeamSeat(a) || (isTeamSeat(b) && a.team === b.team));
  const [open, setOpen] = useState(false);
  const [focusVolume, setFocusVolume] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const items: (NonNullable<MenuProps["items"]>[number] & {
    role?: "menuitemcheckbox";
    "aria-checked"?: boolean;
  })[] = [
    ...(["accepted", "unavailable"].includes(friendAction)
      ? []
      : [
          {
            key: friendAction === "accept" ? "accept-friend" : "friend",
            label:
              friendAction === "pending"
                ? "好友申请已发送"
                : friendAction === "accept"
                  ? "同意好友申请"
                  : "添加好友",
            disabled: friendBusy || friendAction === "pending",
            icon:
              friendAction === "pending" ? (
                <Clock3 size={15} />
              ) : friendAction === "accept" ? (
                <Check size={15} />
              ) : (
                <UserPlus size={15} />
              ),
          },
        ]),
    ...(management.length
      ? [
          ...(["accepted", "unavailable"].includes(friendAction)
            ? []
            : [{ type: "divider" as const }]),
          {
            key: "seat",
            label: "调整席位",
            icon: <Users size={15} />,
            children: seatChoices.map((choice) => {
              const current =
                !!esportsMember && sameSeat(esportsMember.seat, choice.seat);
              const full =
                (esports?.members.filter((m) => sameSeat(m.seat, choice.seat))
                  .length ?? 0) >= esportsSeatLimit(choice.seat, configuration);
              return {
                key: choice.key,
                label: `${choice.label}${current ? "（当前）" : full ? "（已满）" : ""}`,
                disabled: current || full || !esportsMember?.online,
              };
            }),
          },
          { key: "transfer", label: "转移房主", icon: <Crown size={15} /> },
          {
            key: "mute",
            label: "关闭麦克风",
            icon: <MicOff size={15} />,
            disabled: !microphoneAllowed,
          },
          {
            key: "stop-accompaniment",
            label: "关闭伴奏",
            icon: <Square size={15} />,
          },
          {
            key: "block-mic",
            role: "menuitemcheckbox" as const,
            "aria-checked": !microphoneAllowed,
            label: (
              <MenuToggle>
                <span>禁止开麦</span>
                <Switch
                  size="small"
                  checked={!microphoneAllowed}
                  tabIndex={-1}
                  aria-hidden="true"
                />
              </MenuToggle>
            ),
          },
          {
            key: "block-share",
            role: "menuitemcheckbox" as const,
            "aria-checked": !sharingAllowed,
            label: (
              <MenuToggle>
                <span>禁止共享</span>
                <Switch
                  size="small"
                  checked={!sharingAllowed}
                  tabIndex={-1}
                  aria-hidden="true"
                />
              </MenuToggle>
            ),
          },
          ...(management.includes("stop-share")
            ? [
                {
                  key: "stop-share",
                  label: "停止共享",
                  icon: <MonitorOff size={15} />,
                },
              ]
            : []),
          {
            key: "remove",
            label: "移出房间",
            danger: true,
            icon: <LogOut size={15} />,
          },
        ].filter(
          (item) =>
            ("type" in item && item.type === "divider") ||
            management.includes(
              ("key" in item ? item.key : undefined) as MemberManagementAction,
            ),
        )
      : []),
  ];
  const select: MenuProps["onClick"] = ({ key }) => {
    setOpen(false);
    if (key === "transfer" && room.role === "owner") {
      modal.confirm({
        title: `将房主转移给${p.name}？`,
        content: "转移后，你将成为普通成员。",
        okText: "确认转移",
        cancelText: "取消",
        onOk: async () => {
          try {
            await actions.transferRoomOwner(room.id, p.id);
          } catch (error) {
            actions.report(error);
            throw error;
          }
        },
      });
      return;
    }
    void actions.run(async () => {
      const seatChoice = seatChoices.find((choice) => choice.key === key);
      if (seatChoice && management.includes("seat")) {
        await actions.esports.assign(p.id, seatChoice.seat);
        update({ notice: "席位已调整" });
      } else if (key === "friend" || key === "accept-friend") {
        if (friendFlight.current || state().user?.id !== selfId) return;
        const latest = memberFriendAction(
          selfId,
          p.id,
          state().friends.find((f) => f.userId === p.id),
        );
        if (latest !== (key === "accept-friend" ? "accept" : "request")) {
          update({ notice: "好友关系已更新，请重新打开成员菜单" });
          return;
        }
        friendFlight.current = true;
        setFriendBusy(true);
        try {
          unwrap(
            key === "accept-friend"
              ? await actions.api.POST("/api/v1/friends/{userId}/accept", {
                  params: { path: { userId: p.id } },
                })
              : await actions.api.POST("/api/v1/friends", {
                  body: { userId: p.id },
                }),
          );
          if (state().user?.id !== selfId) return;
          update((current) => {
            const existing = current.friends.find((f) => f.userId === p.id);
            return {
              friends: [
                ...current.friends.filter((f) => f.userId !== p.id),
                {
                  userId: p.id,
                  displayName: p.name,
                  incoming: false,
                  ...existing,
                  status:
                    key === "accept-friend" || existing?.status === "accepted"
                      ? "accepted"
                      : "pending",
                },
              ],
              notice: key === "accept-friend" ? "已添加好友" : "好友请求已发送",
            };
          });
          await actions.refreshFriends().catch(actions.report);
        } finally {
          friendFlight.current = false;
          setFriendBusy(false);
        }
      } else if (
        (key === "block-mic" || key === "block-share") &&
        room.role === "owner"
      ) {
        await actions.updateMemberPermissions(
          room.id,
          p.id,
          key === "block-mic"
            ? { microphoneAllowed: !microphoneAllowed }
            : { sharingAllowed: !sharingAllowed },
        );
      } else if (key === "stop-accompaniment" && room.role === "owner") {
        unwrap(
          await actions.api.POST(
            "/api/v1/rooms/{roomId}/members/{userId}/accompaniment/stop",
            { params: { path: { roomId: room.id, userId: p.id } }, body: {} },
          ),
        );
        update({ notice: `已关闭${p.name}的伴奏` });
      } else if (key === "mute" && room.role === "owner") {
        unwrap(
          await actions.api.POST(
            "/api/v1/rooms/{roomId}/members/{userId}/microphone/mute",
            {
              params: { path: { roomId: room.id, userId: p.id } },
              body: {},
            },
          ),
        );
        update({ notice: `已关闭${p.name}的麦克风` });
      } else if (key === "stop-share" && room.role === "owner") {
        unwrap(
          await actions.api.DELETE(
            "/api/v1/rooms/{roomId}/members/{userId}/share",
            {
              params: { path: { roomId: room.id, userId: p.id } },
            },
          ),
        );
        update({ notice: `已停止${p.name}的共享` });
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
          (!p.local || management.length > 0) &&
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
          {statusText ??
            (!microphoneAllowed
              ? "已被禁止开麦"
              : p.speaking
                ? "正在说话"
                : p.microphone
                  ? "语音已就绪"
                  : "麦克风已关闭")}
          {!sharingAllowed && " / 禁止共享"}
        </small>
      </div>
      <div className="member-status">
        {p.accompaniment && (
          <Tooltip title="正在播放伴奏">
            <span
              role="img"
              aria-label="正在播放伴奏"
              style={{
                color: "#bca5ff",
                display: "inline-flex",
                flexShrink: 0,
              }}
            >
              <Music2 size={14} />
            </span>
          </Tooltip>
        )}
        {!statusText && (
          <>
            <span
              className={`member-quality ${p.quality === "poor" || p.quality === "lost" ? "poor" : ""}`}
              title={`网络质量：${p.quality === "excellent" ? "优秀" : p.quality === "good" ? "良好" : p.quality === "poor" ? "较差" : p.quality === "lost" ? "已丢失" : "测量中"}`}
            >
              <Signal size={12} />
            </span>
            <span className={`member-mic ${p.microphone ? "" : "off"}`}>
              {p.microphone ? <Mic size={14} /> : <MicOff size={14} />}
            </span>
          </>
        )}
        {(!p.local || management.length > 0) && (
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
  if (p.local && !management.length) return children ?? row;
  return (
    <Dropdown
      trigger={["contextMenu"]}
      align={{
        htmlRegion: "visible",
        offset: [0, 0],
        overflow: { adjustX: true, adjustY: true, shiftX: true, shiftY: true },
      }}
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onVolumeCommit?.(volume);
        setFocusVolume(false);
        setOpen(nextOpen);
      }}
      destroyOnHidden
      menu={{
        items,
        onClick: select,
        expandIcon: <ChevronRight size={14} aria-hidden="true" />,
      }}
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
                  '[role="slider"], [role^="menuitem"]:not([aria-disabled="true"])',
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
          {!p.local && (
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
                max={200}
                value={volume}
                tooltip={{ formatter: (value) => `${value}%` }}
                onChange={onVolumeChange}
                onChangeComplete={onVolumeCommit}
              />
            </div>
          )}
          {menu}
        </MemberPopup>
      )}
    >
      {isValidElement(children)
        ? cloneElement(
            children as ReactElement<{
              onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
            }>,
            {
              onKeyDown(event: KeyboardEvent<HTMLElement>) {
                (
                  children.props as {
                    onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
                  }
                ).onKeyDown?.(event);
                if (
                  event.key === "ContextMenu" ||
                  (event.shiftKey && event.key === "F10")
                ) {
                  event.preventDefault();
                  setFocusVolume(true);
                  setOpen(true);
                }
              },
            },
          )
        : (children ?? row)}
    </Dropdown>
  );
}
