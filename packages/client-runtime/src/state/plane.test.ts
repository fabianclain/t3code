import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  WS_METHODS,
  type PlaneConnectionStatus,
  type PlaneProjectsResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "../connection/model.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import type * as RpcSession from "../rpc/session.ts";
import { createPlaneEnvironmentAtoms } from "./plane.ts";

const makeTarget = (id: string) =>
  new PrimaryConnectionTarget({
    environmentId: EnvironmentId.make(id),
    label: id,
    httpBaseUrl: `https://${id}.example.test`,
    wsBaseUrl: `wss://${id}.example.test`,
  });

function queryConnectionState(
  overrides: Partial<SupervisorConnectionState> = {},
): SupervisorConnectionState {
  return {
    ...AVAILABLE_CONNECTION_STATE,
    desired: true,
    network: "online",
    phase: "connected",
    attempt: 1,
    generation: 1,
    ...overrides,
  };
}

interface FakePlaneRpc {
  readonly session: RpcSession.RpcSession;
  readonly calls: { status: number; projects: number };
  status: PlaneConnectionStatus;
  projects: PlaneProjectsResult;
}

function makeFakePlaneRpc(): FakePlaneRpc {
  const calls = { status: 0, projects: 0 };
  const rpc: FakePlaneRpc = {
    calls,
    status: { configured: false, baseUrl: null, workspaceSlug: null },
    projects: {
      projects: [],
      page: { nextCursor: null, hasNext: false, totalResults: null },
    },
    session: {
      client: {
        [WS_METHODS.planeConnectionStatus]: () => {
          calls.status += 1;
          return Effect.succeed(rpc.status);
        },
        [WS_METHODS.planeListProjects]: () => {
          calls.projects += 1;
          return Effect.succeed(rpc.projects);
        },
      },
    } as unknown as RpcSession.RpcSession,
  };
  return rpc;
}

const makeRuntime = Effect.fn("TestPlane.makeRuntime")(function* (
  environments: ReadonlyArray<{
    readonly target: PrimaryConnectionTarget;
    readonly rpc: FakePlaneRpc;
  }>,
) {
  const supervisors = new Map<string, EnvironmentSupervisor.EnvironmentSupervisor["Service"]>();
  const states = new Map<string, SubscriptionRef.SubscriptionRef<SupervisorConnectionState>>();
  for (const { target, rpc } of environments) {
    const state = yield* SubscriptionRef.make(queryConnectionState());
    states.set(target.environmentId, state);
    const supervisor: EnvironmentSupervisor.EnvironmentSupervisor["Service"] =
      EnvironmentSupervisor.EnvironmentSupervisor.of({
        target,
        state,
        session: yield* SubscriptionRef.make(Option.some(rpc.session)),
        prepared: yield* SubscriptionRef.make<Option.Option<PreparedConnection>>(Option.none()),
        connect: Effect.void,
        disconnect: Effect.void,
        retryNow: Effect.void,
      } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
    supervisors.set(target.environmentId, supervisor);
  }
  const run: EnvironmentRegistry.EnvironmentRegistry["Service"]["run"] = (environmentId, effect) =>
    Effect.provideService(
      effect,
      EnvironmentSupervisor.EnvironmentSupervisor,
      supervisors.get(environmentId)!,
    );
  const followStream: EnvironmentRegistry.EnvironmentRegistry["Service"]["followStream"] = (
    environmentId,
    stream,
  ) =>
    SubscriptionRef.changes(states.get(environmentId)!).pipe(
      Stream.switchMap(() =>
        Stream.provideService(
          stream,
          EnvironmentSupervisor.EnvironmentSupervisor,
          supervisors.get(environmentId)!,
        ),
      ),
    );
  const stateChanges: EnvironmentRegistry.EnvironmentRegistry["Service"]["stateChanges"] = (
    environmentId,
  ) => SubscriptionRef.changes(states.get(environmentId)!);
  const environmentRegistry = EnvironmentRegistry.EnvironmentRegistry.of({
    run,
    followStream,
    stateChanges,
  } as unknown as EnvironmentRegistry.EnvironmentRegistry["Service"]);
  return Atom.runtime(Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, environmentRegistry));
});

const readEnvironmentQuery = <A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>,
) =>
  AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true }).pipe(
    Effect.tap(() => Effect.yieldNow),
  );

describe("plane environment atoms", () => {
  it.effect("a changed connection refetches the environment's reads and replaces its answers", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const envA = makeTarget("plane-a");
        const envB = makeTarget("plane-b");
        const rpcA = makeFakePlaneRpc();
        const rpcB = makeFakePlaneRpc();
        rpcA.projects = {
          projects: [
            {
              id: "p-old",
              name: "Old workspace",
              identifier: "OLD",
              url: "https://old.test/p/old",
            },
          ],
          page: { nextCursor: null, hasNext: false, totalResults: 1 },
        };
        const runtime = yield* makeRuntime([
          { target: envA, rpc: rpcA },
          { target: envB, rpc: rpcB },
        ]);
        const signalA = Atom.make(0).pipe(Atom.keepAlive);
        const signalB = Atom.make(0).pipe(Atom.keepAlive);
        const signals = new Map([
          [envA.environmentId, signalA],
          [envB.environmentId, signalB],
        ]);
        const plane = createPlaneEnvironmentAtoms(runtime, {
          connectionChangedSignal: (environmentId) => signals.get(environmentId)!,
        });
        const registry = AtomRegistry.make();
        const statusA = plane.connectionStatus({ environmentId: envA.environmentId, input: {} });
        const projectsA = plane.projects({ environmentId: envA.environmentId, input: {} });
        const projectsB = plane.projects({ environmentId: envB.environmentId, input: {} });
        const unmounts = [
          registry.mount(statusA),
          registry.mount(projectsA),
          registry.mount(projectsB),
        ];
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            for (const unmount of unmounts) unmount();
            registry.dispose();
          }),
        );

        expect(yield* readEnvironmentQuery(registry, statusA)).toEqual({
          configured: false,
          baseUrl: null,
          workspaceSlug: null,
        });
        expect(yield* readEnvironmentQuery(registry, projectsA)).toMatchObject({
          projects: [{ id: "p-old" }],
        });
        expect(yield* readEnvironmentQuery(registry, projectsB)).toMatchObject({ projects: [] });
        expect(rpcA.calls.status).toBe(1);
        const callsBAfterMount = rpcB.calls.projects;

        // The user saved the connection: the instance's answers change and A's config moves.
        rpcA.status = {
          configured: true,
          baseUrl: "https://plane.example.com",
          workspaceSlug: "new-workspace",
        };
        rpcA.projects = {
          projects: [
            {
              id: "p-new",
              name: "New workspace",
              identifier: "NEW",
              url: "https://new.test/p/new",
            },
          ],
          page: { nextCursor: null, hasNext: false, totalResults: 1 },
        };
        registry.set(signalA, 1);

        expect(yield* readEnvironmentQuery(registry, statusA)).toMatchObject({
          configured: true,
          workspaceSlug: "new-workspace",
        });
        expect(yield* readEnvironmentQuery(registry, projectsA)).toMatchObject({
          projects: [{ id: "p-new" }],
        });
        expect(rpcB.calls.projects).toBe(callsBAfterMount);
        expect(yield* readEnvironmentQuery(registry, projectsB)).toMatchObject({ projects: [] });
      }),
    ),
  );
});
