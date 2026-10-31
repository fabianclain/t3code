import type {
  EnvironmentId,
  PlaneProject,
  PlaneProjectMetadata,
  PlaneTask,
} from "@t3tools/contracts";
import { formatDateTimeShort } from "@t3tools/shared/usageFormat";
import { LinkIcon, TextIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { PLANE_DEFAULT_PER_PAGE } from "@t3tools/contracts";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import { Separator } from "~/components/ui/separator";
import { Spinner } from "~/components/ui/spinner";
import { usePlaneCommentPages } from "~/state/plane";
import { PlaneHtmlContent } from "./PlaneHtmlContent";
import {
  mergePlaneCommentPages,
  planeAssigneeNames,
  planeCommentActorName,
  planeHtmlToPlainText,
  planePriorityLabel,
  planeStateById,
} from "./planeTaskList.logic";

/**
 * Read-only view of one selected task. The page resolves the full-task RPC and passes the
 * result here; comments are fetched inside. `actions` (and `children` below the body) carry
 * the page's write controls, so this file stays read-only.
 */
export interface PlaneTaskReadDetailProps {
  readonly environmentId: EnvironmentId;
  readonly project: PlaneProject;
  readonly task: PlaneTask;
  readonly metadata: PlaneProjectMetadata | null;
  /** Write controls slot, rendered between the header and the description. */
  readonly actions?: ReactNode;
  /** Extra content below the comment list. */
  readonly children?: ReactNode;
}

export function PlaneTaskReadDetail({
  environmentId,
  project,
  task,
  metadata,
  actions,
  children,
}: PlaneTaskReadDetailProps) {
  const state = planeStateById(metadata, task.stateId);
  const assigneeNames = planeAssigneeNames(metadata, task);
  const copyLink = useCopyToClipboard({ target: "plane-task-link" });
  const copyContent = useCopyToClipboard({ target: "plane-task-content" });
  const descriptionText = planeHtmlToPlainText(task.descriptionHtml);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-col gap-3 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {project.identifier === null ? "" : `${project.identifier}-`}
            {task.sequenceId}
          </Badge>
          {state !== null ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {state.color !== null ? (
                <span
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{ backgroundColor: state.color }}
                />
              ) : null}
              {state.name}
            </span>
          ) : null}
          <span className="ml-auto flex items-center gap-1">
            <Button onClick={() => copyLink.copyToClipboard(task.url)} size="sm" variant="outline">
              <LinkIcon />
              Copy link
            </Button>
            <Button
              aria-label="Copy task content"
              onClick={() =>
                copyContent.copyToClipboard(`${task.name}\n\n${descriptionText}`.trim())
              }
              size="icon-sm"
              variant="ghost"
            >
              <TextIcon />
            </Button>
          </span>
        </div>
        <h1 className="text-lg font-medium break-words text-balance">{task.name}</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{planePriorityLabel(task.priority)}</span>
          {assigneeNames.length > 0 ? <span>{assigneeNames.join(", ")}</span> : null}
          {task.createdAt !== null ? (
            <span>Created {formatDateTimeShort(task.createdAt)}</span>
          ) : null}
        </div>
        {copyLink.isCopied || copyContent.isCopied ? (
          <p className="text-xs text-muted-foreground" role="status">
            {copyLink.isCopied ? "Link copied." : "Content copied."}
          </p>
        ) : null}
        {actions}
      </div>
      <Separator />
      <div className="flex flex-col gap-4 px-5 py-4">
        <PlaneHtmlContent html={task.descriptionHtml} emptyText="No description." />
      </div>
      <Separator />
      <PlaneTaskComments
        environmentId={environmentId}
        metadata={metadata}
        projectId={project.id}
        taskId={task.id}
      />
      {children}
    </div>
  );
}

function PlaneTaskComments({
  environmentId,
  projectId,
  taskId,
  metadata,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: string;
  readonly taskId: string;
  readonly metadata: PlaneProjectMetadata | null;
}) {
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const commentPages = usePlaneCommentPages(
    environmentId,
    cursors.map((cursor) => ({
      projectId,
      taskId,
      perPage: PLANE_DEFAULT_PER_PAGE,
      ...(cursor === null ? {} : { cursor }),
    })),
  );
  const pages = commentPages.results.map((result) =>
    result._tag === "Success" ? result.value : null,
  );
  const comments = mergePlaneCommentPages(pages);
  const lastPage = pages[pages.length - 1] ?? null;
  const nextCursor =
    lastPage?.page.hasNext === true && lastPage.page.nextCursor !== null
      ? lastPage.page.nextCursor
      : null;
  const firstPagePending = commentPages.results[0]?.waiting ?? false;
  const isLoadingMore = commentPages.results[cursors.length - 1]?.waiting ?? false;

  return (
    <div className="flex flex-col gap-2 px-5 py-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium">Comments</h2>
        <span className="text-xs text-muted-foreground">{comments.length}</span>
        <Button
          aria-label="Refresh comments"
          className="ml-auto"
          onClick={commentPages.refresh}
          size="icon-sm"
          variant="ghost"
        >
          <RefreshIcon refreshing={commentPages.results.some((result) => result.waiting)} />
        </Button>
      </div>
      {firstPagePending && comments.length === 0 ? (
        <Spinner />
      ) : commentPages.error !== null && comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{commentPages.error}</p>
      ) : comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments.</p>
      ) : (
        <ul aria-label="Comments" className="flex flex-col gap-3">
          {comments.map((comment) => (
            <li className="flex flex-col gap-1" key={comment.id}>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {planeCommentActorName(metadata, comment.actorId) ?? "Unknown"}
                </span>
                {comment.createdAt !== null ? (
                  <span>{formatDateTimeShort(comment.createdAt)}</span>
                ) : null}
              </div>
              <PlaneHtmlContent html={comment.html} />
            </li>
          ))}
        </ul>
      )}
      {nextCursor !== null ? (
        <div>
          <Button
            disabled={isLoadingMore}
            onClick={() => setCursors([...cursors, nextCursor])}
            size="sm"
            variant="outline"
          >
            {isLoadingMore ? <Spinner /> : null}
            Load more comments
          </Button>
        </div>
      ) : null}
    </div>
  );
}
