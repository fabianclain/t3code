import {
  PlaneCreateTaskInput,
  PlaneUpdateTaskInput,
  type PlanePriority,
  type PlaneTask,
} from "@t3tools/contracts";

/** What the task form edits. The user works on one of these, not on a Plane task. */
export interface PlaneTaskDraft {
  readonly name: string;
  readonly descriptionHtml: string;
  readonly priority: PlanePriority;
  readonly stateId: string | null;
  readonly assigneeIds: ReadonlyArray<string>;
}

export type PlaneTaskCreatePayload = typeof PlaneCreateTaskInput.Type;
export type PlaneTaskUpdatePayload = typeof PlaneUpdateTaskInput.Type;

/** A new task starts blank; an existing one starts as Plane stored it, byte for byte. */
export function createPlaneTaskDraft(task: PlaneTask | null): PlaneTaskDraft {
  if (task === null) {
    return { name: "", descriptionHtml: "", priority: "none", stateId: null, assigneeIds: [] };
  }
  return {
    name: task.name,
    descriptionHtml: task.descriptionHtml,
    priority: task.priority,
    stateId: task.stateId,
    assigneeIds: [...task.assigneeIds],
  };
}

function sameAssignees(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right);
  return left.every((id) => rightIds.has(id));
}

/** True when the draft differs from the state the editor opened with. */
export function planeTaskDraftIsDirty(draft: PlaneTaskDraft, baseline: PlaneTaskDraft): boolean {
  return (
    draft.name.trim() !== baseline.name.trim() ||
    draft.descriptionHtml !== baseline.descriptionHtml ||
    draft.priority !== baseline.priority ||
    draft.stateId !== baseline.stateId ||
    !sameAssignees(draft.assigneeIds, baseline.assigneeIds)
  );
}

/** Plane rejects a task without a name. */
export function planeTaskDraftNameError(draft: PlaneTaskDraft): string | null {
  return draft.name.trim().length === 0 ? "Give the task a name." : null;
}

/**
 * The fields an edit sends: only what the user changed. An untouched description stays out
 * of the request, so Plane keeps the HTML it stores instead of a rewritten copy of it.
 */
export function buildPlaneTaskUpdatePayload(input: {
  readonly projectId: string;
  readonly taskId: string;
  readonly baseline: PlaneTaskDraft;
  readonly draft: PlaneTaskDraft;
}): PlaneTaskUpdatePayload {
  const { baseline, draft } = input;
  const name = draft.name.trim();
  return {
    projectId: input.projectId,
    taskId: input.taskId,
    ...(name !== baseline.name.trim() ? { name } : {}),
    ...(draft.descriptionHtml !== baseline.descriptionHtml
      ? { descriptionHtml: draft.descriptionHtml }
      : {}),
    ...(draft.priority !== baseline.priority ? { priority: draft.priority } : {}),
    // The contract carries a state id, not a null: a state the user removed travels as none.
    ...(draft.stateId !== baseline.stateId ? { stateId: draft.stateId ?? "" } : {}),
    ...(!sameAssignees(draft.assigneeIds, baseline.assigneeIds)
      ? { assigneeIds: [...draft.assigneeIds] }
      : {}),
  };
}

/** The fields a new task sends. Empty values stay out so Plane applies its own defaults. */
export function buildPlaneTaskCreatePayload(input: {
  readonly projectId: string;
  readonly draft: PlaneTaskDraft;
}): PlaneTaskCreatePayload {
  const { draft } = input;
  return {
    projectId: input.projectId,
    name: draft.name.trim(),
    ...(draft.descriptionHtml.trim().length > 0 ? { descriptionHtml: draft.descriptionHtml } : {}),
    ...(draft.priority !== "none" ? { priority: draft.priority } : {}),
    ...(draft.stateId !== null ? { stateId: draft.stateId } : {}),
    ...(draft.assigneeIds.length > 0 ? { assigneeIds: [...draft.assigneeIds] } : {}),
  };
}

/** Rich text that carries nothing: whitespace, empty markup, or entities on their own. */
export function planeCommentHtmlIsEmpty(html: string): boolean {
  if (/<(?:img|hr|table|iframe|video|audio|embed|object)\b/iu.test(html)) return false;
  const text = html
    .replace(/<[^>]*>/gu, " ")
    .replace(/&(?:nbsp|#160|#xa0);/giu, " ")
    .trim();
  return text.length === 0;
}
