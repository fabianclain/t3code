import { createFileRoute } from "@tanstack/react-router";

import type { EnvironmentId } from "@t3tools/contracts";

import { TasksRoute } from "../components/planeTasks/PlaneTasksPage";

export const Route = createFileRoute("/_chat/tasks")({
  validateSearch: (raw: Record<string, unknown>) => ({
    // Branded like the pull-requests route: both name the same T3 environment, and the merged
    // search schema must not split the key into a plain-string union.
    ...(typeof raw.environmentId === "string" && raw.environmentId.trim().length > 0
      ? { environmentId: raw.environmentId.slice(0, 100) as EnvironmentId }
      : {}),
    ...(typeof raw.planeProjectId === "string" && raw.planeProjectId.trim().length > 0
      ? { planeProjectId: raw.planeProjectId.slice(0, 100) }
      : {}),
    ...(typeof raw.taskId === "string" && raw.taskId.trim().length > 0
      ? { taskId: raw.taskId.slice(0, 100) }
      : {}),
  }),
  component: TasksRoute,
});
