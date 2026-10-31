import type {
  PlaneComment,
  PlaneCommentsResult,
  PlanePageInfo,
  PlanePriority,
  PlaneProjectMetadata,
  PlaneSearchResult,
  PlaneState,
  PlaneTask,
  PlaneTasksResult,
} from "@t3tools/contracts";

/**
 * One fetched page per cursor, in fetch order. Cursor paging has no server-side offset, so a
 * refetch that inserted rows shifts later pages and the same task can appear twice.
 */
export function mergePlaneTaskPages(
  pages: ReadonlyArray<PlaneTasksResult | null>,
): Array<PlaneTask> {
  const seen = new Set<string>();
  const tasks: Array<PlaneTask> = [];
  for (const page of pages) {
    if (page === null) continue;
    for (const task of page.tasks) {
      if (seen.has(task.id)) continue;
      seen.add(task.id);
      tasks.push(task);
    }
  }
  return tasks;
}

/**
 * The cursor to append, only when the last fetched page says a next one exists. A page
 * without `hasNext` is the end of the list even if a cursor string came along, and a
 * `hasNext` page without a cursor cannot be continued.
 */
export function nextPlaneListCursor(page: PlanePageInfo | null): string | null {
  if (page === null || !page.hasNext || page.nextCursor === null) return null;
  return page.nextCursor;
}

/**
 * Comment pages merge by id like task pages: a refresh after a new comment shifts the cursor
 * window and can serve the same comment from two fetched pages.
 */
export function mergePlaneCommentPages(
  pages: ReadonlyArray<PlaneCommentsResult | null>,
): Array<PlaneComment> {
  const seen = new Set<string>();
  const comments: Array<PlaneComment> = [];
  for (const page of pages) {
    if (page === null) continue;
    for (const comment of page.comments) {
      if (seen.has(comment.id)) continue;
      seen.add(comment.id);
      comments.push(comment);
    }
  }
  return comments;
}

export interface PlaneTaskFilters {
  readonly stateId: string | null;
  readonly priority: PlanePriority | null;
  readonly assigneeId: string | null;
}

export const NO_PLANE_TASK_FILTERS: PlaneTaskFilters = {
  stateId: null,
  priority: null,
  assigneeId: null,
};

export function hasActivePlaneTaskFilters(filters: PlaneTaskFilters): boolean {
  return filters.stateId !== null || filters.priority !== null || filters.assigneeId !== null;
}

/**
 * Browse filtering runs on tasks already fetched. The project list endpoint takes no
 * filters, so callers must say so — this is never a complete workspace answer.
 */
export function filterPlaneTasks(
  tasks: ReadonlyArray<PlaneTask>,
  filters: PlaneTaskFilters,
): Array<PlaneTask> {
  if (!hasActivePlaneTaskFilters(filters)) return [...tasks];
  return tasks.filter(
    (task) =>
      (filters.stateId === null || task.stateId === filters.stateId) &&
      (filters.priority === null || task.priority === filters.priority) &&
      (filters.assigneeId === null || task.assigneeIds.includes(filters.assigneeId)),
  );
}

export interface PlaneSearchView {
  readonly hits: PlaneSearchResult["hits"];
  readonly truncated: boolean;
}

/** Search answers are bounded; the visible cap mirrors the server's own limit. */
export function planeSearchView(result: PlaneSearchResult, visibleLimit: number): PlaneSearchView {
  return {
    hits: result.hits.slice(0, visibleLimit),
    truncated: result.truncated || result.hits.length > visibleLimit,
  };
}

export interface PlaneEnvironmentCandidate<T extends string = string> {
  readonly id: T;
  readonly connected: boolean;
}

/**
 * One user, one Plane connection: the route's environment when it is connected, else the
 * primary environment when it is connected, else nothing. An explicit but disconnected
 * environment never falls back to a different host — the page shows why it cannot browse.
 */
export function selectPlaneEnvironment<T extends string>(
  requestedId: T | null,
  primaryId: T | null,
  candidates: ReadonlyArray<PlaneEnvironmentCandidate<T>>,
): T | null {
  const connected = (id: T | null): boolean =>
    id !== null && candidates.some((candidate) => candidate.id === id && candidate.connected);
  if (requestedId !== null) return connected(requestedId) ? requestedId : null;
  return connected(primaryId) ? primaryId : null;
}

/** True when the URL names an environment that exists but is not usable right now. */
export function isDisconnectedEnvironmentRequest<T extends string>(
  requestedId: T | null,
  candidates: ReadonlyArray<PlaneEnvironmentCandidate<T>>,
): boolean {
  return (
    requestedId !== null &&
    candidates.some((candidate) => candidate.id === requestedId && !candidate.connected)
  );
}

/** Members and states are read through the project metadata; unknown ids degrade to ids. */
export function planeStateById(
  metadata: PlaneProjectMetadata | null,
  stateId: string | null,
): PlaneState | null {
  if (metadata === null || stateId === null) return null;
  return metadata.states.find((state) => state.id === stateId) ?? null;
}

function planeMemberName(metadata: PlaneProjectMetadata | null, memberId: string): string {
  const member = metadata?.members.find((candidate) => candidate.id === memberId);
  return member?.displayName ?? memberId;
}

export function planeAssigneeNames(
  metadata: PlaneProjectMetadata | null,
  task: PlaneTask,
): Array<string> {
  return task.assigneeIds.map((memberId) => planeMemberName(metadata, memberId));
}

const PLANE_PRIORITY_LABELS: Record<PlanePriority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "No priority",
};

export function planePriorityLabel(priority: PlanePriority): string {
  return PLANE_PRIORITY_LABELS[priority];
}

/** Copy-content needs text, not the stored HTML. Tags vanish; entities decode. */
export function planeHtmlToPlainText(html: string): string {
  if (!html.includes("<")) return decodePlaneEntities(html).replace(/\s+/gu, " ").trim();
  const withBlockBreaks = html
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/blockquote)\b[^>]*>/giu, "\n")
    .replace(/<li\b[^>]*>/giu, "- ");
  const text = decodePlaneEntities(withBlockBreaks.replace(/<[^>]*>/gu, " "));
  return text
    .split("\n")
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function decodePlaneEntities(html: string): string {
  return html
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&nbsp;/gu, " ");
}

/** Plane members render by display name; an unknown actor keeps its id rather than vanishing. */
export function planeCommentActorName(
  metadata: PlaneProjectMetadata | null,
  actorId: string | null,
): string | null {
  return actorId === null ? null : planeMemberName(metadata, actorId);
}
