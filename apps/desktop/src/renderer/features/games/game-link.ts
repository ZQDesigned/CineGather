import { unwrap, ApiError, FeatureUpdateError } from "@cinegather/api-client";
import {
  alignGameAuthorization,
  GameLinkCoordinator,
} from "@cinegather/client-core";
import { gameConnectionObservationSchema } from "@cinegather/contracts";
import type { createApi } from "@cinegather/api-client";
import { update, state, useApp } from "../../store";
import {
  publishClientNotification,
  notificationInbox,
} from "../notifications/client-notifications";
type GameLinkServices = {
  api: ReturnType<typeof createApi>;
  report: (error: unknown) => void;
};
// The application supplies shared services after creating its API client.
// Keeping this boundary explicit avoids importing the application orchestrator.
let services: GameLinkServices;
export function configureGameLink(dependencies: GameLinkServices) {
  services = dependencies;
}
const path = (sessionId: string) => ({ path: { sessionId } });
export const gameLink = new GameLinkCoordinator({
  api: {
    snapshot: async () => unwrap(await services.api.GET("/api/v1/games")),
    create: async (body) =>
      unwrap(await services.api.POST("/api/v1/games", { body })),
    ready: async (id) =>
      unwrap(
        await services.api.POST("/api/v1/games/{sessionId}/ready", {
          params: path(id),
        }),
      ),
    renew: async (id, revision) =>
      unwrap(
        await services.api.POST("/api/v1/games/{sessionId}/renew", {
          params: path(id),
          body: { revision },
        }),
      ),
    transport: async (id) => {
      const started = performance.now();
      const result = await services.api.GET(
        "/api/v1/games/{sessionId}/transport",
        {
          params: path(id),
        },
      );
      const receivedAtMs = Date.now();
      const roundTripMs = performance.now() - started;
      const config = unwrap(result);
      const timestamp = result.response.headers.get("X-CineGather-Server-Time");
      return alignGameAuthorization(config, {
        serverTimeMs: timestamp ? Number(timestamp) : NaN,
        receivedAtMs,
        roundTripMs,
      });
    },
    leave: async (id) =>
      unwrap(
        await services.api.POST("/api/v1/games/{sessionId}/leave", {
          params: path(id),
        }),
      ),
  },
  ...(window.desktop?.gameLink
    ? {
        local: {
          probe: (port, game) => window.desktop!.gameLink!.probe(port, game),
          configure: (
            transport: import("@cinegather/contracts").GameTunnelConfig,
            worldPort?: number,
          ) => window.desktop!.gameLink!.configure({ transport, worldPort }),
          stop: () => window.desktop!.gameLink!.stop(),
          status: () => window.desktop!.gameLink!.status(),
        },
      }
    : {}),
  changed: (game) => {
    const previous = state().game;
    update({ game });
    if (
      game.local.reason === "world-unavailable" &&
      previous.local.reason !== "world-unavailable" &&
      game.snapshot.self?.role === "host" &&
      game.snapshot.session
    )
      publishClientNotification({
        eventId: "game-world-unavailable:" + crypto.randomUUID(),
        category: "system",
        title: "游戏联机已暂停",
        body: game.local.message,
        target: "games",
        entityId: game.snapshot.session.id,
      });
  },
  failure: (error) => {
    if (
      error instanceof FeatureUpdateError ||
      (error instanceof ApiError && error.status === 401)
    )
      services.report(error);
  },
});
export function bindGameLink(scope: () => string | undefined) {
  if (!window.desktop?.gameLink) return () => {};
  let disposed = false;
  let syncing = false;
  let activeScope = scope();
  const sync = async () => {
    if (disposed || syncing) return;
    syncing = true;
    try {
      await gameLink.scope(scope());
      if (disposed) return;
      await gameLink.refresh();
      if (disposed) return;
      const { snapshot } = gameLink.state;
      for (const invite of snapshot.invitations)
        publishClientNotification({
          eventId: "game-invitation:" + invite.id,
          category: "invitation",
          title: `${invite.hostName} 邀请你游戏联机`,
          body: invite.sessionName,
          target: "games",
          entityId: invite.id,
          expiresAt: Date.parse(invite.expiresAt),
        });
      if (snapshot.self?.role === "host")
        for (const request of snapshot.requests)
          publishClientNotification({
            eventId: "game-request:" + request.id,
            category: "room-request",
            title: `${request.displayName} 申请加入联机`,
            body: snapshot.session?.name,
            target: "games",
            entityId: request.id,
            expiresAt: Date.parse(request.expiresAt),
          });
      for (const n of notificationInbox.snapshot())
        if (
          n.target === "games" &&
          n.active &&
          !(
            n.eventId.startsWith("game-world-unavailable:") &&
            n.entityId === snapshot.session?.id &&
            gameLink.state.local.reason === "world-unavailable"
          ) &&
          !snapshot.invitations.some((i) => i.id === n.entityId) &&
          !snapshot.requests.some((r) => r.id === n.entityId)
        )
          notificationInbox.resolve(n.id);
    } catch {
      /* the coordinator exposes synchronization failures on its own page */
    } finally {
      syncing = false;
    }
  };
  const timer = setInterval(() => void sync(), 5000);
  const unsubscribe = useApp.subscribe((next, previous) => {
    if (next.user !== previous.user && scope() !== activeScope) {
      activeScope = scope();
      void gameLink
        .scope(scope())
        .then(() => sync())
        .catch(() => {});
    }
  });
  const remove = window.desktop?.gameLink?.onConnection((raw) => {
    const parsed = gameConnectionObservationSchema.safeParse(raw);
    if (!parsed.success || !state().user) return;
    const event = parsed.data;
    if (
      gameLink.state.snapshot.session?.id !== event.sessionId ||
      gameLink.state.snapshot.self?.role !== "host"
    )
      return;
    void services.api
      .POST("/api/v1/games/{sessionId}/members/{memberId}/connection", {
        params: {
          path: { sessionId: event.sessionId, memberId: event.memberId },
        },
        body: { revision: event.revision, route: event.route },
      })
      .catch(() => {});
  });
  void sync();
  return () => {
    disposed = true;
    clearInterval(timer);
    unsubscribe();
    remove?.();
    void gameLink.scope(undefined).catch(() => {});
  };
}
export async function refreshGame() {
  if (!window.desktop?.gameLink) return;
  await gameLink.refresh();
}

// Stateful coordinators must restart with their lifecycle bindings. Component-only
// edits still use Fast Refresh; replacing a service requires a fresh renderer.
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
