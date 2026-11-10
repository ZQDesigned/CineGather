import styled from "@emotion/styled";
import { Clapperboard } from "lucide-react";

const Loading = styled.div`
  min-height: 280px;
  display: grid;
  place-items: center;
  color: #bca5ff;
  .session-animation {
    position: relative;
    width: 64px;
    height: 64px;
  }
  .session-ring {
    display: block;
    width: 64px;
    height: 64px;
  }
  .session-film {
    position: absolute;
    inset: 18px;
    width: 28px;
    height: 28px;
    transform: rotate(-13deg);
    transform-origin: center;
    animation: session-film 2.8s ease-in-out infinite;
  }
  .session-orbit {
    transform-origin: 32px 32px;
    animation: session-orbit 1.5s linear infinite;
  }
  @keyframes session-orbit {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes session-film {
    0%,
    100% {
      transform: rotate(-13deg);
      opacity: 0.8;
    }
    50% {
      transform: rotate(-5deg);
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .session-orbit,
    .session-film {
      animation: none;
    }
  }
`;

export function SessionLoading() {
  return (
    <Loading role="status" aria-label="正在进入映聚" aria-busy="true">
      <span className="session-animation" aria-hidden="true">
        <svg className="session-ring" viewBox="0 0 64 64" fill="none">
          <circle
            cx="32"
            cy="32"
            r="27"
            stroke="currentColor"
            strokeWidth="2"
            opacity=".12"
          />
          <g
            className="session-orbit"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          >
            <path d="M32 5a27 27 0 0 1 25.7 18.7" />
            <path d="M32 59A27 27 0 0 1 6.3 40.3" opacity=".45" />
          </g>
        </svg>
        <Clapperboard className="session-film" size={28} strokeWidth={1.1} />
      </span>
    </Loading>
  );
}
