import { WS_METHODS, type EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom, AtomRegistry } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";

/** Lists may serve their page for a minute; a task body the user opened is shown fresher. */
const PLANE_LIST_STALE_TIME_MS = 60_000;
const PLANE_DETAIL_STALE_TIME_MS = 30_000;
const PLANE_METADATA_STALE_TIME_MS = 5 * 60_000;

const projectScope = (environmentId: string, projectId: string): string =>
  JSON.stringify([environmentId, projectId]);

const taskScope = (environmentId: string, projectId: string, taskId: string): string =>
  JSON.stringify([environmentId, projectId, taskId]);

interface PlaneMutationTarget<P> {
  readonly environmentId: string;
  readonly input: P;
}

export interface PlaneEnvironmentAtomOptions {
  /**
   * A value that changes whenever an environment's saved Plane connection is created, edited,
   * or removed. Read families re-request while mounted, so a connection change never keeps
   * serving the previous Plane instance's status, projects, tasks, or comments.
   */
  readonly connectionChangedSignal?: (environmentId: EnvironmentId) => Atom.Atom<unknown>;
}

/**
 * Plane reads and writes over one environment's WebSocket. Read families are RPC query atoms
 * keyed by `{environmentId, input}`; write commands carry the `tasks:write` permission assigned
 * in contracts and bump a signal so reads of the touched project/task refetch after a write.
 */
export function createPlaneEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
  options: PlaneEnvironmentAtomOptions = {},
) {
  const commandScheduler = createAtomCommandScheduler();
  const mutationSignals = Atom.family((scope: string) =>
    Atom.make(0).pipe(Atom.withLabel(`environment-data:plane:mutations:${scope}`)),
  );
  const connectionChangedSignal = options.connectionChangedSignal;
  // One read-refresh value per {environment, project, task} scope: the connection signal plus
  // every mutation scope the family follows, so any of them refetches the query while read.
  const readRefreshSignal = Atom.family((key: string) => {
    const [environmentId, projectId, taskId] = JSON.parse(key) as readonly [
      EnvironmentId,
      string | null,
      string | null,
    ];
    return Atom.make((get) => {
      const parts: Array<unknown> = [];
      if (connectionChangedSignal !== undefined) {
        parts.push(get(connectionChangedSignal(environmentId)));
      }
      if (projectId !== null) {
        parts.push(get(mutationSignals(projectScope(environmentId, projectId))));
      }
      if (projectId !== null && taskId !== null) {
        parts.push(get(mutationSignals(taskScope(environmentId, projectId, taskId))));
      }
      return parts.length === 1 ? parts[0] : parts;
    }).pipe(Atom.withLabel(`environment-data:plane:read-refresh:${key}`));
  });
  const connectionRefreshTrigger =
    connectionChangedSignal === undefined
      ? undefined
      : ({ environmentId }: { readonly environmentId: EnvironmentId }) =>
          readRefreshSignal(JSON.stringify([environmentId, null, null]));
  const bump =
    <P>(...scopes: ReadonlyArray<(target: PlaneMutationTarget<P>) => string>) =>
    (target: PlaneMutationTarget<P>, registry: AtomRegistry.AtomRegistry): Effect.Effect<void> =>
      Effect.sync(() => {
        for (const scope of scopes) {
          registry.update(mutationSignals(scope(target)), (count) => count + 1);
        }
      });

  return {
    connectionStatus: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:plane:connection-status",
      tag: WS_METHODS.planeConnectionStatus,
      staleTimeMs: PLANE_LIST_STALE_TIME_MS,
      ...(connectionRefreshTrigger === undefined
        ? {}
        : { refreshTrigger: connectionRefreshTrigger }),
    }),
    testConnection: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:plane:test-connection",
      tag: WS_METHODS.planeTestConnection,
      // An explicit verify always re-asks the instance.
      staleTimeMs: 0,
    }),
    projects: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:plane:projects",
      tag: WS_METHODS.planeListProjects,
      staleTimeMs: PLANE_LIST_STALE_TIME_MS,
      ...(connectionRefreshTrigger === undefined
        ? {}
        : { refreshTrigger: connectionRefreshTrigger }),
    }),
    metadata: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:plane:metadata",
      tag: WS_METHODS.planeProjectMetadata,
      staleTimeMs: PLANE_METADATA_STALE_TIME_MS,
      ...(connectionRefreshTrigger === undefined
        ? {}
        : { refreshTrigger: connectionRefreshTrigger }),
    }),
    tasks: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:plane:tasks",
      tag: WS_METHODS.planeListTasks,
      staleTimeMs: PLANE_LIST_STALE_TIME_MS,
      refreshTrigger: ({ environmentId, input }) =>
        readRefreshSignal(JSON.stringify([environmentId, input.projectId, null])),
    }),
    search: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:plane:search",
      tag: WS_METHODS.planeSearchTasks,
      staleTimeMs: PLANE_LIST_STALE_TIME_MS,
      // A rename or create must not leave stale hits; search input carries the project.
      refreshTrigger: ({ environmentId, input }) =>
        readRefreshSignal(JSON.stringify([environmentId, input.projectId, null])),
    }),
    task: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:plane:task",
      tag: WS_METHODS.planeGetTask,
      staleTimeMs: PLANE_DETAIL_STALE_TIME_MS,
      refreshTrigger: ({ environmentId, input }) =>
        readRefreshSignal(JSON.stringify([environmentId, input.projectId, input.taskId])),
    }),
    comments: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:plane:comments",
      tag: WS_METHODS.planeListComments,
      staleTimeMs: PLANE_LIST_STALE_TIME_MS,
      refreshTrigger: ({ environmentId, input }) =>
        readRefreshSignal(JSON.stringify([environmentId, input.projectId, input.taskId])),
    }),
    createTask: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:plane:create-task",
      tag: WS_METHODS.planeCreateTask,
      scheduler: commandScheduler,
      concurrency: { mode: "serial", key: ({ environmentId }) => environmentId },
      onSuccess: bump((target) => projectScope(target.environmentId, target.input.projectId)),
    }),
    updateTask: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:plane:update-task",
      tag: WS_METHODS.planeUpdateTask,
      scheduler: commandScheduler,
      concurrency: { mode: "serial", key: ({ environmentId }) => environmentId },
      onSuccess: bump(
        (target) => projectScope(target.environmentId, target.input.projectId),
        (target) => taskScope(target.environmentId, target.input.projectId, target.input.taskId),
      ),
    }),
    addComment: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:plane:add-comment",
      tag: WS_METHODS.planeAddComment,
      scheduler: commandScheduler,
      concurrency: { mode: "serial", key: ({ environmentId }) => environmentId },
      onSuccess: bump(
        (target) => projectScope(target.environmentId, target.input.projectId),
        (target) => taskScope(target.environmentId, target.input.projectId, target.input.taskId),
      ),
    }),
  };
}
