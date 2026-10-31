import { useAtomValue } from "@effect/atom-react";
import { createPlaneEnvironmentAtoms } from "@t3tools/client-runtime/state/plane";
import {
  PlaneCommentsResult,
  PlaneListCommentsInput,
  PlaneListProjectsInput,
  PlaneListTasksInput,
  PlaneProjectsResult,
  PlaneTasksResult,
  type EnvironmentId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { formatEnvironmentQueryError } from "./query";
import { serverEnvironment } from "./server";

/**
 * The saved Plane connection of one environment, straight from the server config projection.
 * Saving, changing, or removing the connection replaces this value, which the shared factory
 * turns into a refresh of that environment's Plane reads — so an edited connection never
 * keeps serving the previous instance's status, projects, tasks, or comments.
 */
const planeConnectionChangedSignal = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(
    (get) => get(serverEnvironment.configValueAtom(environmentId))?.settings.plane ?? null,
  ).pipe(Atom.withLabel("web-plane:connection-changed")),
);

/**
 * Plane RPC state for every environment this client talks to. Read families are paged by
 * cursor, so a view that loads more reads one atom per fetched page and merges the pages.
 */
export const planeEnvironment = createPlaneEnvironmentAtoms(connectionAtomRuntime, {
  connectionChangedSignal: planeConnectionChangedSignal,
});

function createPagedPlaneQuery<A, I extends { readonly cursor?: string }>(
  label: string,
  query: (target: {
    readonly environmentId: EnvironmentId;
    readonly input: I;
  }) => Atom.Atom<AsyncResult.AsyncResult<A, unknown>>,
) {
  const pagesFamily = Atom.family((key: string) => {
    const targets = JSON.parse(key) as ReadonlyArray<{
      readonly environmentId: EnvironmentId;
      readonly input: I;
    }>;
    return Atom.make((get) => targets.map((target) => get(query(target)))).pipe(
      Atom.withLabel(`${label}:pages`),
    );
  });
  return function usePagedPlaneQuery(environmentId: EnvironmentId, inputs: ReadonlyArray<I>) {
    const key = JSON.stringify(inputs.map((input) => ({ environmentId, input })));
    const results = useAtomValue(pagesFamily(key));
    const failure = results.find((result) => result._tag === "Failure");
    return {
      results,
      error: failure === undefined ? null : formatEnvironmentQueryError(failure.cause),
      refresh: () => {
        for (const atom of new Set(inputs.map((input) => query({ environmentId, input })))) {
          appAtomRegistry.refresh(atom);
        }
      },
    };
  };
}

export const usePlaneTaskPages = createPagedPlaneQuery<
  PlaneTasksResult,
  Schema.Schema.Type<typeof PlaneListTasksInput>
>("web-plane:tasks", (target) => planeEnvironment.tasks(target));

export const usePlaneCommentPages = createPagedPlaneQuery<
  PlaneCommentsResult,
  Schema.Schema.Type<typeof PlaneListCommentsInput>
>("web-plane:comments", (target) => planeEnvironment.comments(target));

export const usePlaneProjectPages = createPagedPlaneQuery<
  PlaneProjectsResult,
  Schema.Schema.Type<typeof PlaneListProjectsInput>
>("web-plane:projects", (target) => planeEnvironment.projects(target));
