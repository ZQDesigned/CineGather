import { useEffect, useState } from "react";
import { Avatar } from "antd";
import { Global, css } from "@emotion/react";
import styled from "@emotion/styled";
import { Crown, Mic, MicOff, MonitorUp } from "lucide-react";
import type { MemberOverlayView } from "@cinegather/contracts";
import { cinemaFont } from "./styles";
const Surface = styled.section<{ $backgroundOpacity: number }>`
  margin: 4px;
  padding: 6px;
  border: 1px solid #ffffff25;
  border-radius: 12px;
  background: rgba(
    21,
    24,
    32,
    ${({ $backgroundOpacity }) => $backgroundOpacity / 100}
  );
  color: #e9e9ef;
  font-family: ${cinemaFont};
  font-size: 12px;
  overflow: hidden;
  header {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 20px;
    color: #aaa5bc;
  }
  header strong {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 11px;
    font-weight: 500;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    height: 34px;
    margin-top: 4px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 3px;
    border-radius: 7px;
  }
  li[data-speaking="true"] {
    background: #5ed9a014;
  }
  .ant-avatar {
    flex: none;
    background: #bca5ff24;
    color: #d8caff;
    border: 1px solid transparent;
  }
  li[data-speaking="true"] .ant-avatar {
    border-color: #73d9a8;
    box-shadow: 0 0 0 2px #73d9a821;
  }
  .name {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .you {
    color: #9992aa;
    font-size: 10px;
  }
  .owner {
    color: #d7ba81;
    flex: none;
  }
  .sharing {
    color: #c9b4ff;
    flex: none;
  }
  .mic {
    color: #888b9b;
    flex: none;
  }
  li[data-speaking="true"] .mic {
    color: #73d9a8;
  }
`;
export function MemberOverlay() {
  const [view, setView] = useState<MemberOverlayView>({
    snapshot: null,
    backgroundOpacity: 85,
  });
  useEffect(() => {
    const bridge = window.memberOverlay!;
    let active = true,
      changed = false;
    const unsubscribe = bridge.onChange((next) => {
      changed = true;
      if (active) setView(next);
    });
    void bridge.state().then((next) => {
      if (active && !changed) setView(next);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return (
    <>
      <Global
        styles={css`
          :root {
            color-scheme: dark;
            background: transparent !important;
          }
          html,
          body,
          #root,
          .ant-app {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            min-width: 0;
            background: transparent !important;
            overflow: hidden;
            user-select: none;
            box-sizing: border-box;
          }
          *,
          *::before,
          *::after {
            box-sizing: border-box;
          }
        `}
      />
      {view.snapshot && (
        <Surface
          aria-label="房间成员浮层"
          $backgroundOpacity={view.backgroundOpacity}
        >
          <header>
            <strong>{view.snapshot.roomName}</strong>
            <span>{view.snapshot.members.length} 人</span>
          </header>
          <ul>
            {view.snapshot.members.map((member) => (
              <li
                key={member.id}
                aria-label={member.name}
                data-speaking={member.speaking}
              >
                <Avatar size={26}>{Array.from(member.name)[0]}</Avatar>
                <span className="name">{member.name}</span>
                {member.local && <span className="you">你</span>}
                {member.owner && (
                  <Crown size={13} className="owner" aria-label="房主" />
                )}
                {member.sharing && (
                  <MonitorUp
                    size={14}
                    className="sharing"
                    aria-label="正在共享"
                  />
                )}
                {member.microphone ? (
                  <Mic
                    size={14}
                    className="mic"
                    aria-label={member.speaking ? "正在说话" : "麦克风已开启"}
                  />
                ) : (
                  <MicOff size={14} className="mic" aria-label="麦克风已关闭" />
                )}
              </li>
            ))}
          </ul>
        </Surface>
      )}
    </>
  );
}
