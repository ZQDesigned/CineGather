import { Button } from "antd";
import styled from "@emotion/styled";
import {
  ArrowDownToLine,
  Gamepad2,
  Headphones,
  Link2,
  Monitor,
  Users,
} from "lucide-react";
import { update } from "../store";

const Page = styled.section`
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 28px;
  .promo-heading {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 24px;
  }
  .promo-heading h1 {
    font-size: 24px;
  }
  .promo-hero {
    position: relative;
    overflow: hidden;
    display: grid;
    grid-template-columns: 1fr 1fr;
    align-items: center;
    gap: 30px;
    padding: 44px;
    border: 1px solid #b39bff24;
    border-radius: 24px;
    background:
      radial-gradient(ellipse at 95% 0%, #7e5cc82b, transparent 65%), #161720;
  }
  .promo-copy {
    position: relative;
    z-index: 1;
  }
  .promo-copy h2 {
    font-size: clamp(30px, 3.4vw, 48px);
    font-weight: 650;
    line-height: 1.35;
    letter-spacing: -1px;
  }
  .promo-copy h2 span {
    color: var(--purple);
  }
  .promo-copy p {
    max-width: 360px;
    margin: 22px 0 28px;
    color: #a2a4b3;
    font-size: 15px;
    line-height: 1.9;
  }
  .promo-copy .ant-btn {
    height: 44px;
    padding-inline: 22px;
    font-weight: 600;
  }
  .promo-platforms {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 16px;
    color: var(--muted);
    font-size: 12px;
  }
  .world-card {
    transform: rotate(-3deg);
    padding: 12px;
    border: 1px solid #ffffff16;
    border-radius: 20px;
    background: #1d2029;
    box-shadow: 0 22px 55px #0005;
  }
  .world-art {
    border-radius: 12px;
    overflow: hidden;
    background:
      radial-gradient(ellipse at 50% 60%, #4a555e40, transparent 70%),
      linear-gradient(150deg, #252b3b, #141a25);
  }
  .world-art svg {
    display: block;
    width: 100%;
    max-height: 285px;
  }
  .world-caption {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    padding: 18px 8px 8px;
  }
  .world-caption h3 {
    font-size: 16px;
  }
  .supported {
    border-radius: 20px;
    padding: 4px 10px;
    background: #81bc8b16;
    color: #a2d7aa;
    font-size: 11px;
    white-space: nowrap;
  }
  .world-friends {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 8px 4px;
    font-size: 12px;
    color: #9b9eae;
  }
  .friend-faces {
    display: flex;
    padding-left: 4px;
  }
  .friend-faces span {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    margin-left: -4px;
    border-radius: 50%;
    border: 2px solid #1d2029;
    background: #54436c;
    color: #d9c8ff;
  }
  .friend-faces span:nth-of-type(2) {
    background: #385960;
    color: #b7dfdc;
  }
  .friend-faces span:nth-of-type(3) {
    background: #655241;
    color: #ead0ad;
  }
  .promo-features {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
    margin-top: 20px;
  }
  .promo-feature {
    padding: 22px;
    border: 1px solid #ffffff0d;
    border-radius: 16px;
    background: #14161d;
  }
  .promo-feature > svg {
    color: var(--purple);
    margin-bottom: 15px;
  }
  .promo-feature h3 {
    font-size: 15px;
    margin-bottom: 8px;
  }
  .promo-feature p {
    color: var(--muted);
    font-size: 12px;
    line-height: 1.7;
  }
  @media (max-width: 1100px) {
    .promo-hero {
      padding: 28px;
      gap: 22px;
    }
    .promo-copy h2 {
      font-size: 32px;
    }
    .world-card {
      transform: none;
    }
    .world-caption {
      flex-wrap: wrap;
    }
    .promo-feature {
      padding: 16px;
    }
  }
  @media (max-width: 850px) {
    padding: 20px;
    .promo-hero {
      grid-template-columns: 1fr;
    }
    .world-card {
      max-width: 380px;
      width: 100%;
      justify-self: center;
    }
    .promo-features {
      grid-template-columns: 1fr;
    }
    .promo-feature > svg {
      margin-bottom: 8px;
    }
  }
`;

function WorldArt() {
  return (
    <svg viewBox="0 0 420 300" aria-hidden="true">
      <defs>
        <radialGradient id="game-world-glow">
          <stop stopColor="#b39bff" stopOpacity=".25" />
          <stop offset="1" stopColor="#b39bff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse
        cx="215"
        cy="205"
        rx="180"
        ry="80"
        fill="url(#game-world-glow)"
      />
      <ellipse cx="210" cy="238" rx="130" ry="27" fill="#0b101b" opacity=".5" />
      {[
        [130, 130],
        [210, 90],
        [290, 130],
        [90, 150],
        [170, 110],
        [250, 150],
        [130, 170],
        [210, 190],
        [290, 170],
      ].map(([x, y], i) => (
        <g key={i} transform={`translate(${x} ${y})`}>
          <path d="M-40 0 0 20 0 66 -40 46Z" fill="#685144" />
          <path d="M0 20 40 0 40 46 0 66Z" fill="#493d37" />
          <path
            d="M-40 0 0-20 40 0 0 20Z"
            fill={i % 3 === 0 ? "#9bb878" : "#7f9f6a"}
          />
          <path d="M-40 0 0 20 0 30 -40 10Z" fill="#66875b" />
          <path d="M0 20 40 0 40 10 0 30Z" fill="#55774d" />
        </g>
      ))}
      <path
        d="M231 100 242 94 253 100 253 145 242 151 231 145Z"
        fill="#7c6150"
      />
      <path d="M201 55 241 35 281 55 281 97 241 117 201 97Z" fill="#466f57" />
      <path d="M201 55 241 75 281 55 241 35Z" fill="#719a6b" />
      <path d="M241 75 281 55 281 97 241 117Z" fill="#385b49" />
      <path d="M177 56 196 47 214 56 214 77 196 86 177 77Z" fill="#567b58" />
      <path
        d="M101 83h4m-2-2v4M325 73h6m-3-3v6M339 189h4m-2-2v4"
        stroke="#c6b4f1"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M63 212q-20-85 66-129M333 110q26 44 3 81"
        fill="none"
        stroke="#a898cf"
        strokeOpacity=".2"
        strokeDasharray="4 7"
      />
    </svg>
  );
}

export function GameLinkPromo() {
  return (
    <Page aria-label="游戏联机介绍">
      <div className="promo-heading">
        <Gamepad2 size={25} />
        <h1>游戏联机</h1>
      </div>
      <section className="promo-hero">
        <div className="promo-copy">
          <h2>
            下一次冒险，
            <br />
            <span>一起出发。</span>
          </h2>
          <p>在映聚客户端，和好友走进同一个游戏世界。</p>
          <Button
            type="primary"
            icon={<ArrowDownToLine size={18} />}
            onClick={() => update({ modal: "download" })}
          >
            下载客户端，开始联机
          </Button>
          <div className="promo-platforms">
            <Monitor size={14} />
            <span>支持 Windows 和 macOS</span>
          </div>
        </div>
        <div className="world-card">
          <div className="world-art">
            <WorldArt />
          </div>
          <div className="world-caption">
            <h3>Minecraft Java 版</h3>
            <span className="supported">现已支持</span>
          </div>
          <div className="world-friends">
            <div className="friend-faces" aria-hidden="true">
              <span>
                <Users size={12} />
              </span>
              <span>
                <Gamepad2 size={12} />
              </span>
              <span>
                <Headphones size={12} />
              </span>
            </div>
            <span>和好友一起探索，最多 8 人</span>
          </div>
        </div>
      </section>
      <div className="promo-features">
        <article className="promo-feature">
          <Users size={22} />
          <h3>熟悉的好友，一键邀请</h3>
          <p>从好友列表发出邀请，加入同一个世界。</p>
        </article>
        <article className="promo-feature">
          <Link2 size={22} />
          <h3>一个联机码，就能相聚</h3>
          <p>分享联机码，主机同意后即可加入。</p>
        </article>
        <article className="promo-feature">
          <Headphones size={22} />
          <h3>边聊边玩，不用切换</h3>
          <p>联机与放映房同时在线，冒险也有陪伴。</p>
        </article>
      </div>
    </Page>
  );
}
