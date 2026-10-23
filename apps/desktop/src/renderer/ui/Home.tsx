import { Avatar, Button, Card, Tag } from "antd";
import {
  ArrowUpRight,
  Plus,
  Clapperboard,
  Headphones,
  Film,
  LockKeyhole,
} from "lucide-react";
import { useApp, update } from "../store";
import * as actions from "../controller";
export function Home({ onEnterRoom }: { onEnterRoom: () => void }) {
  const app = useApp();
  return (
    <div className="home">
      <div className="page-heading">
        <div>
          <h1>
            晚上好，{app.user?.displayName}
            <span className="heading-spark">✦</span>
          </h1>
          <p>挑一部好片，叫上那些想见的人。</p>
        </div>
        <Button onClick={() => update({ modal: "join" })}>
          <ArrowUpRight size={16} />
          加入房间
        </Button>
      </div>
      <section className="home-hero">
        <div>
          <h2>
            好时光，
            <br />
            值得<span>一起看。</span>
          </h2>
          <p>
            共享你的屏幕，也分享此刻的心情。
            <br />
            从一个属于你们的放映室开始。
          </p>
          <Button type="primary" onClick={() => update({ modal: "create" })}>
            <Plus size={18} />
            创建私人房间
          </Button>
        </div>
        <div className="hero-cinema">
          <div className="hero-screen">
            <Clapperboard size={52} strokeWidth={1} />
            <span>CINEGATHER</span>
            <div className="screen-glow" />
          </div>
          <div className="seats">
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
        </div>
      </section>
      <div className="section-heading">
        <h2>
          你的房间 <span>{app.rooms.length}</span>
        </h2>
        <span>凭房间号加入，每间最多 10 位朋友</span>
      </div>
      <div className="room-grid">
        {app.rooms.map((room) => (
          <Card className="room-card" key={room.id} hoverable>
            <div className="room-card-top">
              <Avatar
                size={42}
                shape="square"
                icon={<Film size={23} strokeWidth={1.5} />}
              />
              <div className="room-card-info">
                <h3 title={room.name}>{room.name}</h3>
                <div className="room-card-details">
                  <Tag
                    icon={
                      room.access === "password" ? (
                        <LockKeyhole size={10} />
                      ) : undefined
                    }
                  >
                    {room.access === "password" ? "加密房" : "普通房"}
                  </Tag>
                  <span>{room.code}</span>
                </div>
              </div>
            </div>
            <div className="room-card-footer">
              <span>
                {room.role === "owner" ? "我创建的" : "朋友的房间"}，最多{" "}
                {room.maxMembers} 人
              </span>
              <Button
                type="link"
                size="small"
                aria-label={`进入${room.name}`}
                onClick={() =>
                  void actions.run(async () => {
                    if (await actions.enterKnownRoom(room)) onEnterRoom();
                  })
                }
                disabled={app.busy || app.roomState === "joining"}
              >
                进入房间
                <ArrowUpRight size={15} />
              </Button>
            </div>
          </Card>
        ))}
        <Card className="room-card new-room">
          <Button
            type="text"
            icon={<Plus size={19} />}
            onClick={() => update({ modal: "create" })}
          >
            新建房间
          </Button>
        </Card>
      </div>
      <div className="home-note">
        <Headphones size={19} />
        <p>
          <strong>戴上耳机，让陪伴更清晰。</strong>
          <span>语音和共享声音可以独立调节，找到你们最舒服的音量。</span>
        </p>
      </div>
    </div>
  );
}
