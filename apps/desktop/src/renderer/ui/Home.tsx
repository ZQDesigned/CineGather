import {
  ArrowUpRight,
  Plus,
  Clapperboard,
  Headphones,
  Film,
} from "lucide-react";
import { useApp, update } from "../store";
import * as actions from "../controller";
export function Home() {
  const app = useApp();
  return (
    <div className="home">
      <div className="page-heading">
        <div>
          <span className="eyebrow">A LITTLE CLOSER, EVERY NIGHT</span>
          <h1>
            晚上好，{app.user?.displayName}
            <span className="heading-spark">✦</span>
          </h1>
          <p>挑一部好片，叫上那些想见的人。</p>
        </div>
        <button className="secondary" onClick={() => update({ modal: "join" })}>
          <ArrowUpRight size={16} />
          加入房间
        </button>
      </div>
      <section className="home-hero">
        <div>
          <span className="pill">
            <span className="live-dot" />
            为朋友留一排好座位
          </span>
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
          <button
            className="primary"
            onClick={() => update({ modal: "create" })}
          >
            <Plus size={18} />
            创建私人房间
          </button>
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
          <span className="hero-caption">THE BEST SEAT IS NEXT TO YOU.</span>
        </div>
      </section>
      <div className="section-heading">
        <h2>
          你的房间 <span>{app.rooms.length}</span>
        </h2>
        <span>凭邀请加入 · 每间最多 10 位朋友</span>
      </div>
      <div className="room-grid">
        {app.rooms.map((room) => (
          <button
            className="room-card"
            key={room.id}
            onClick={() =>
              void actions.run(() => actions.roomSession.enter(room.id))
            }
            disabled={app.busy || app.roomState === "joining"}
          >
            <div className="room-card-art">
              <Film size={32} strokeWidth={1} />
              <span>{room.role === "owner" ? "我的房间" : "朋友的房间"}</span>
            </div>
            <div className="room-card-copy">
              <h3>{room.name}</h3>
              <span>
                最多 {room.maxMembers} 人<ArrowUpRight size={18} />
              </span>
            </div>
          </button>
        ))}
        <button
          className="room-card new-room"
          onClick={() => update({ modal: "create" })}
        >
          <div className="new-plus">
            <Plus size={25} />
          </div>
          <h3>为相聚留个位置</h3>
          <p>创建一个新的私人房间</p>
        </button>
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
