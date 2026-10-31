import type { PlaneTask } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  buildPlaneTaskCreatePayload,
  buildPlaneTaskUpdatePayload,
  createPlaneTaskDraft,
  planeCommentHtmlIsEmpty,
  planeTaskDraftIsDirty,
  planeTaskDraftNameError,
} from "./planeTaskDraft";

function makeTask(overrides: Partial<PlaneTask> = {}): PlaneTask {
  return {
    id: "task-1",
    sequenceId: 12,
    name: "Ship the release",
    descriptionHtml: "<p>Original <strong>description</strong></p>",
    priority: "medium",
    projectId: "project-1",
    stateId: "state-1",
    assigneeIds: ["member-1", "member-unknown"],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    url: "https://plane.example/projects/project-1/issues/task-1/",
    ...overrides,
  };
}

describe("buildPlaneTaskUpdatePayload", () => {
  it("sends only the title when the description was not touched", () => {
    const task = makeTask();
    const baseline = createPlaneTaskDraft(task);
    const payload = buildPlaneTaskUpdatePayload({
      projectId: task.projectId,
      taskId: task.id,
      baseline,
      draft: { ...baseline, name: "Ship the release v2" },
    });

    expect(payload).toEqual({
      projectId: "project-1",
      taskId: "task-1",
      name: "Ship the release v2",
    });
    expect("descriptionHtml" in payload).toBe(false);
  });

  it("keeps the original assignees out of the request when only the state changed", () => {
    const task = makeTask();
    const baseline = createPlaneTaskDraft(task);
    const payload = buildPlaneTaskUpdatePayload({
      projectId: task.projectId,
      taskId: task.id,
      baseline,
      draft: { ...baseline, stateId: "state-2" },
    });

    expect(payload.stateId).toBe("state-2");
    expect("assigneeIds" in payload).toBe(false);
    expect("descriptionHtml" in payload).toBe(false);
  });

  it("sends the description once it was edited, including an explicit empty one", () => {
    const task = makeTask();
    const baseline = createPlaneTaskDraft(task);

    const edited = buildPlaneTaskUpdatePayload({
      projectId: task.projectId,
      taskId: task.id,
      baseline,
      draft: { ...baseline, descriptionHtml: "<p>Rewritten</p>" },
    });
    expect(edited.descriptionHtml).toBe("<p>Rewritten</p>");

    const cleared = buildPlaneTaskUpdatePayload({
      projectId: task.projectId,
      taskId: task.id,
      baseline,
      draft: { ...baseline, descriptionHtml: "" },
    });
    expect(cleared.descriptionHtml).toBe("");
  });

  it("sends the whole assignee list only when the assignment changed", () => {
    const task = makeTask();
    const baseline = createPlaneTaskDraft(task);
    const payload = buildPlaneTaskUpdatePayload({
      projectId: task.projectId,
      taskId: task.id,
      baseline,
      draft: { ...baseline, assigneeIds: ["member-2"] },
    });

    expect(payload.assigneeIds).toEqual(["member-2"]);
  });
});

describe("buildPlaneTaskCreatePayload", () => {
  it("sends the draft values and leaves empty ones out", () => {
    const payload = buildPlaneTaskCreatePayload({
      projectId: "project-1",
      draft: {
        name: "  New task  ",
        descriptionHtml: "<p>Body</p>",
        priority: "high",
        stateId: "state-3",
        assigneeIds: ["member-1", "member-unknown"],
      },
    });

    expect(payload).toEqual({
      projectId: "project-1",
      name: "New task",
      descriptionHtml: "<p>Body</p>",
      priority: "high",
      stateId: "state-3",
      assigneeIds: ["member-1", "member-unknown"],
    });
  });

  it("omits a description, state and assignees the user left empty", () => {
    const payload = buildPlaneTaskCreatePayload({
      projectId: "project-1",
      draft: {
        name: "Bare task",
        descriptionHtml: "",
        priority: "none",
        stateId: null,
        assigneeIds: [],
      },
    });

    expect(payload).toEqual({ projectId: "project-1", name: "Bare task" });
  });
});

describe("planeTaskDraftIsDirty", () => {
  it("reports an untouched draft as clean", () => {
    const task = makeTask();
    const baseline = createPlaneTaskDraft(task);
    expect(planeTaskDraftIsDirty(baseline, baseline)).toBe(false);
  });

  it("reports an edited description as dirty", () => {
    const task = makeTask();
    const baseline = createPlaneTaskDraft(task);
    const draft = { ...baseline, descriptionHtml: "<p>Changed</p>" };
    expect(planeTaskDraftIsDirty(draft, baseline)).toBe(true);
  });

  it("treats a name that only gained whitespace as unchanged", () => {
    const task = makeTask();
    const baseline = createPlaneTaskDraft(task);
    expect(planeTaskDraftIsDirty({ ...baseline, name: "  Ship the release  " }, baseline)).toBe(
      false,
    );
  });
});

describe("planeTaskDraftNameError", () => {
  it("rejects a name that is only whitespace", () => {
    expect(planeTaskDraftNameError(createPlaneTaskDraft(makeTask({ name: "   " })))).toBe(
      "Give the task a name.",
    );
    expect(planeTaskDraftNameError(createPlaneTaskDraft(makeTask()))).toBeNull();
  });
});

describe("planeCommentHtmlIsEmpty", () => {
  it.each([
    ["empty markup", ""],
    ["blank paragraph", "<p> </p>"],
    ["only a non breaking space", "<p>&nbsp;</p>"],
  ])("treats %s as empty", (_label, html) => {
    expect(planeCommentHtmlIsEmpty(html)).toBe(true);
  });

  it.each([
    ["text", "<p>Ship it</p>"],
    ["an image", '<p><img src="https://example.com/a.png" alt="a" /></p>'],
  ])("keeps %s", (_label, html) => {
    expect(planeCommentHtmlIsEmpty(html)).toBe(false);
  });
});
