import { useAtomValue } from "@effect/atom-react";
import { PLANE_DEFAULT_PER_PAGE, type EnvironmentId, type PlaneProject } from "@t3tools/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  ListTodoIcon,
  MessageSquarePlusIcon,
  PlusIcon,
  SquarePenIcon,
} from "lucide-react";
import { useState } from "react";

import { isElectron } from "~/env";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { planeEnvironment, usePlaneProjectPages } from "~/state/plane";
import { cn } from "~/lib/utils";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import { PlaneTaskDialogsProvider, usePlaneTaskDialogs } from "./PlaneTaskDialogs";
import { PlaneTaskList } from "./PlaneTaskList";
import { PlaneTaskReadDetail } from "./PlaneTaskReadDetail";
import { isDisconnectedEnvironmentRequest, selectPlaneEnvironment } from "./planeTaskList.logic";

/** Route search for `/_chat/tasks`; validated in the route file. `environmentId` is a T3
 * environment (branded there); `planeProjectId`/`taskId` are Plane-side ids. */
export interface TasksSearch {
  readonly environmentId?: EnvironmentId;
  readonly planeProjectId?: string;
  readonly taskId?: string;
}

const NO_PROJECT = "none";

/** Desktop gate: web and mobile render a notice; the entry points are hidden there too. */
export function TasksRoute() {
  if (!isElectron) return <PlaneTasksDesktopOnlyNotice />;
  return <PlaneTasksPage />;
}

function PlaneTasksDesktopOnlyNotice() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <p className="flex max-w-sm flex-col items-center gap-2 text-center text-sm text-muted-foreground">
        <ListTodoIcon aria-hidden className="size-5" />
        Plane tasks are available in the T3 Code desktop app.
      </p>
    </div>
  );
}

function PlaneTasksPage() {
  const search = useSearch({ from: "/_chat/tasks" });
  const navigate = useNavigate({ from: "/tasks" });
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();

  const requestedEnvironmentId = search.environmentId ?? null;
  const environmentCandidates = environments.map((environment) => ({
    id: environment.environmentId,
    connected: environment.serverConfig !== null && environment.connection.phase === "connected",
  }));
  const environmentId = selectPlaneEnvironment(
    requestedEnvironmentId,
    primaryEnvironmentId,
    environmentCandidates,
  );
  const requestedEnvironment =
    environmentId === null &&
    isDisconnectedEnvironmentRequest(requestedEnvironmentId, environmentCandidates)
      ? (environments.find((environment) => environment.environmentId === requestedEnvironmentId) ??
        null)
      : null;

  const statusQuery = useEnvironmentQuery(
    environmentId === null ? null : planeEnvironment.connectionStatus({ environmentId, input: {} }),
  );
  const configured = statusQuery.data?.configured === true;
  const workspaceSlug = statusQuery.data?.workspaceSlug ?? null;

  const updateSearch = (patch: {
    readonly [Key in keyof TasksSearch]?: TasksSearch[Key] | undefined;
  }) =>
    void navigate({
      search: (previous: TasksSearch): TasksSearch => {
        const next = { ...previous, ...patch };
        return {
          ...(next.environmentId ? { environmentId: next.environmentId } : {}),
          ...(next.planeProjectId ? { planeProjectId: next.planeProjectId } : {}),
          ...(next.taskId ? { taskId: next.taskId } : {}),
        };
      },
      replace: true,
    });

  // Scope the settings panel to this environment: an explicit machine, never a silent
  // fallback to the primary or local host in a desktop plus remote setup.
  const openConnectionSettings = (targetEnvironmentId: EnvironmentId) =>
    void navigate({ to: "/settings/plane", search: { machine: targetEnvironmentId } });

  let body: React.ReactNode;
  if (environmentId === null) {
    body =
      requestedEnvironment !== null ? (
        <PlaneTasksNotice message={`${requestedEnvironment.label} is not connected right now.`} />
      ) : (
        <PlaneTasksNotice message="Connect to an environment to browse its Plane tasks." />
      );
  } else if (statusQuery.data === null && statusQuery.isPending) {
    body = (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  } else if (statusQuery.error !== null && statusQuery.data === null) {
    body = (
      <PlaneTasksNotice
        action={
          <>
            <Button onClick={statusQuery.refresh}>Retry</Button>
            <Button onClick={() => openConnectionSettings(environmentId)} variant="outline">
              Open connection settings
            </Button>
          </>
        }
        message={statusQuery.error}
      />
    );
  } else if (!configured) {
    body = (
      <PlaneTasksNotice
        action={
          <Button onClick={() => openConnectionSettings(environmentId)}>
            Open connection settings
          </Button>
        }
        message={
          statusQuery.data !== null
            ? "No Plane connection is configured for this environment yet."
            : "The Plane connection could not be read."
        }
      />
    );
  } else {
    body = (
      <PlaneTasksBrowse
        environmentId={environmentId}
        key={environmentId}
        onClearTask={() => updateSearch({ taskId: undefined })}
        onSelectProject={(planeProjectId) => updateSearch({ planeProjectId, taskId: undefined })}
        onSelectTask={(taskId) => updateSearch({ taskId })}
        selectedProjectId={search.planeProjectId ?? null}
        selectedTaskId={search.taskId ?? null}
      />
    );
  }

  return (
    <PlaneTaskDialogsProvider
      onSelectTask={(target) =>
        // Created with a captured environment+project; navigating only through the current
        // route context could land the selection in a different one after a disconnect.
        updateSearch({
          environmentId: target.environmentId,
          planeProjectId: target.projectId,
          taskId: target.taskId,
        })
      }
    >
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b px-4 py-2">
          <h1 className="text-sm font-medium">Tasks</h1>
          {workspaceSlug !== null ? <Badge variant="secondary">{workspaceSlug}</Badge> : null}
        </div>
        {body}
      </div>
    </PlaneTaskDialogsProvider>
  );
}

interface PlaneTasksBrowseProps {
  readonly environmentId: EnvironmentId;
  readonly selectedProjectId: string | null;
  readonly selectedTaskId: string | null;
  readonly onSelectProject: (projectId: string) => void;
  readonly onSelectTask: (taskId: string) => void;
  /** Drops the selected task, keeping the environment and project selection. */
  readonly onClearTask: () => void;
}

function PlaneTasksBrowse({
  environmentId,
  selectedProjectId,
  selectedTaskId,
  onSelectProject,
  onSelectTask,
  onClearTask,
}: PlaneTasksBrowseProps) {
  const [projectCursors, setProjectCursors] = useState<Array<string | null>>([null]);
  const projectPages = usePlaneProjectPages(
    environmentId,
    projectCursors.map((cursor) => ({
      perPage: PLANE_DEFAULT_PER_PAGE,
      ...(cursor === null ? {} : { cursor }),
    })),
  );
  const pages = projectPages.results.map((result) =>
    result._tag === "Success" ? result.value : null,
  );
  const seenProjects = new Set<string>();
  const projects: Array<PlaneProject> = [];
  for (const page of pages) {
    for (const project of page?.projects ?? []) {
      if (seenProjects.has(project.id)) continue;
      seenProjects.add(project.id);
      projects.push(project);
    }
  }
  const lastProjectPage = pages[pages.length - 1] ?? null;
  const nextProjectCursor =
    lastProjectPage?.page.hasNext === true && lastProjectPage.page.nextCursor !== null
      ? lastProjectPage.page.nextCursor
      : null;
  const isLoadingMoreProjects = projectPages.results[projectCursors.length - 1]?.waiting ?? false;

  const selectedProject =
    selectedProjectId === null
      ? null
      : (projects.find((project) => project.id === selectedProjectId) ?? null);

  const dialogs = usePlaneTaskDialogs();
  const canCreateTask = useAtomValue(planeEnvironment.createTask.permissionAtom(environmentId));
  const canEditTask = useAtomValue(planeEnvironment.updateTask.permissionAtom(environmentId));
  const canAddComment = useAtomValue(planeEnvironment.addComment.permissionAtom(environmentId));

  const metadataQuery = useEnvironmentQuery(
    selectedProject === null
      ? null
      : planeEnvironment.metadata({ environmentId, input: { projectId: selectedProject.id } }),
  );
  const metadata = metadataQuery.data;
  const metadataFailure =
    selectedProject !== null && metadataQuery.error !== null && metadata === null
      ? metadataQuery.error
      : null;
  const taskQuery = useEnvironmentQuery(
    selectedProject === null || selectedTaskId === null
      ? null
      : planeEnvironment.task({
          environmentId,
          input: { projectId: selectedProject.id, taskId: selectedTaskId },
        }),
  );

  if (projects.length === 0 && projectPages.results[0]?.waiting === true) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (projects.length === 0 && projectPages.error !== null) {
    return (
      <PlaneTasksNotice
        action={<Button onClick={projectPages.refresh}>Retry</Button>}
        message={projectPages.error}
      />
    );
  }
  if (projects.length === 0) {
    return <PlaneTasksNotice message="No projects in this Plane workspace." />;
  }

  const projectItems: Record<string, string> = { [NO_PROJECT]: "Choose a project" };
  for (const project of projects) projectItems[project.id] = project.name;

  const showDetail = selectedProject !== null && selectedTaskId !== null;
  let detail: React.ReactNode = null;
  if (showDetail) {
    const task = taskQuery.data;
    detail = (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col @min-[56.25rem]/tasks:w-[42%] @min-[56.25rem]/tasks:flex-none @min-[56.25rem]/tasks:border-l">
        <div className="flex items-center gap-2 border-b px-4 py-2 @min-[56.25rem]/tasks:hidden">
          <Button onClick={onClearTask} size="sm" variant="outline">
            <ArrowLeftIcon />
            Back to tasks
          </Button>
        </div>
        {task === null && taskQuery.isPending ? (
          <div className="flex flex-1 items-center justify-center">
            <Spinner />
          </div>
        ) : taskQuery.error !== null && task === null ? (
          <PlaneTasksNotice
            action={<Button onClick={taskQuery.refresh}>Retry</Button>}
            message={taskQuery.error}
          />
        ) : task !== null ? (
          <PlaneTaskReadDetail
            environmentId={environmentId}
            key={selectedTaskId}
            metadata={metadata}
            project={selectedProject}
            task={task}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  disabled={metadata === null || !canEditTask}
                  onClick={() => {
                    if (metadata === null) return;
                    dialogs.openTaskEditor({
                      environmentId,
                      projectId: selectedProject.id,
                      task,
                      metadata,
                    });
                  }}
                  size="sm"
                  title={
                    canEditTask ? undefined : "This environment did not grant the tasks permission."
                  }
                  variant="outline"
                >
                  <SquarePenIcon />
                  Edit task
                </Button>
                <Button
                  disabled={!canAddComment}
                  onClick={() =>
                    dialogs.openCommentComposer({
                      environmentId,
                      projectId: selectedProject.id,
                      taskId: task.id,
                    })
                  }
                  size="sm"
                  title={
                    canAddComment
                      ? undefined
                      : "This environment did not grant the tasks permission."
                  }
                  variant="outline"
                >
                  <MessageSquarePlusIcon />
                  Add comment
                </Button>
              </div>
            }
          />
        ) : null}
      </div>
    );
  }

  return (
    // The container query tracks the Tasks area, not the window: the app sidebar takes
    // part of the viewport, so a viewport query misjudges the room list and detail have.
    <div className="@container/tasks flex min-h-0 min-w-0 flex-1">
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col",
          showDetail && "hidden @min-[56.25rem]/tasks:flex",
        )}
      >
        <div className="flex items-center gap-2 border-b px-4 py-2">
          <Select
            items={projectItems}
            onValueChange={(value) => {
              if (typeof value === "string" && value !== NO_PROJECT) onSelectProject(value);
            }}
            value={selectedProject?.id ?? NO_PROJECT}
          >
            <SelectTrigger aria-label="Project" className="w-auto min-w-0 max-w-64" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value={NO_PROJECT}>Choose a project</SelectItem>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          {nextProjectCursor !== null ? (
            <Button
              disabled={isLoadingMoreProjects}
              onClick={() => setProjectCursors([...projectCursors, nextProjectCursor])}
              size="sm"
              variant="ghost"
            >
              {isLoadingMoreProjects ? <Spinner /> : null}
              More projects
            </Button>
          ) : null}
          {selectedProject !== null ? (
            <Button
              className="ml-auto"
              disabled={metadata === null || !canCreateTask}
              onClick={() => {
                if (metadata === null || selectedProject === null) return;
                dialogs.openTaskEditor({
                  environmentId,
                  projectId: selectedProject.id,
                  task: null,
                  metadata,
                });
              }}
              size="sm"
              title={
                canCreateTask ? undefined : "This environment did not grant the tasks permission."
              }
            >
              <PlusIcon />
              New task
            </Button>
          ) : null}
        </div>
        {metadataFailure !== null ? (
          <div className="flex items-center gap-2 border-b px-4 py-1.5">
            <p className="min-w-0 flex-1 truncate text-xs text-destructive">{metadataFailure}</p>
            <Button onClick={metadataQuery.refresh} size="sm" variant="outline">
              Retry
            </Button>
          </div>
        ) : null}
        {selectedProjectId === null ? (
          <PlaneTasksNotice message="Choose a project to see its tasks." />
        ) : selectedProject === null ? (
          <PlaneTasksNotice message="That project is not in the loaded project list. Pick one from the menu." />
        ) : (
          <PlaneTaskList
            environmentId={environmentId}
            key={`${environmentId}:${selectedProject.id}`}
            metadata={metadata}
            onSelectTask={onSelectTask}
            projectIdentifier={selectedProject.identifier}
            projectId={selectedProject.id}
            selectedTaskId={selectedTaskId}
          />
        )}
      </div>
      {detail}
    </div>
  );
}

function PlaneTasksNotice({
  message,
  action,
}: {
  readonly message: string;
  readonly action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </div>
  );
}
