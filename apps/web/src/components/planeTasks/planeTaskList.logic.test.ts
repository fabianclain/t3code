import type {
  PlaneCommentsResult,
  PlaneProjectMetadata,
  PlaneSearchResult,
  PlaneTask,
  PlaneTasksResult,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  filterPlaneTasks,
  hasActivePlaneTaskFilters,
  isDisconnectedEnvironmentRequest,
  mergePlaneCommentPages,
  mergePlaneTaskPages,
  nextPlaneListCursor,
  planeAssigneeNames,
  planeCommentActorName,
  planeHtmlToPlainText,
  planeSearchView,
  planeStateById,
  selectPlaneEnvironment,
} from "./planeTaskList.logic";

function makeTask(overrides: Partial<PlaneTask> & { id: string }): PlaneTask {
  return {
    sequenceId: 1,
    name: `Task ${overrides.id}`,
    descriptionHtml: "",
    priority: "none",
    projectId: "project-1",
    stateId: null,
    assigneeIds: [],
    createdAt: null,
    updatedAt: null,
    url: `https://plane.example.com/ws/projects/project-1/issues/${overrides.id}/`,
    ...overrides,
  };
}

function makePage(
  ids: Array<string>,
  page: Partial<PlaneTasksResult["page"]> = {},
): PlaneTasksResult {
  return {
    tasks: ids.map((id) => makeTask({ id })),
    page: { nextCursor: null, hasNext: false, totalResults: ids.length, ...page },
  };
}

describe("mergePlaneTaskPages", () => {
  it("concatenates pages in fetch order", () => {
    const merged = mergePlaneTaskPages([makePage(["a", "b"]), makePage(["c"])]);
    expect(merged.map((task) => task.id)).toEqual(["a", "b", "c"]);
  });

  it("drops tasks a shifted cursor page served twice", () => {
    const merged = mergePlaneTaskPages([makePage(["a", "b"]), makePage(["b", "c"])]);
    expect(merged.map((task) => task.id)).toEqual(["a", "b", "c"]);
  });

  it("skips pages that have not answered yet", () => {
    const merged = mergePlaneTaskPages([null, makePage(["a"])]);
    expect(merged.map((task) => task.id)).toEqual(["a"]);
  });
});

function makeCommentPage(
  ids: Array<string>,
  page: Partial<PlaneCommentsResult["page"]> = {},
): PlaneCommentsResult {
  return {
    comments: ids.map((id) => ({ id, html: `<p>${id}</p>`, actorId: null, createdAt: null })),
    page: { nextCursor: null, hasNext: false, totalResults: ids.length, ...page },
  };
}

describe("mergePlaneCommentPages", () => {
  it("drops comments a refetch served twice after a posted comment shifted the cursor window", () => {
    const merged = mergePlaneCommentPages([
      makeCommentPage(["c1", "c2"]),
      makeCommentPage(["c2", "c3"]),
    ]);
    expect(merged.map((comment) => comment.id)).toEqual(["c1", "c2", "c3"]);
  });
});

describe("nextPlaneListCursor", () => {
  it("returns the cursor only when the page says a next one exists", () => {
    expect(nextPlaneListCursor({ nextCursor: "c1", hasNext: true, totalResults: 50 })).toBe("c1");
    expect(nextPlaneListCursor({ nextCursor: "c1", hasNext: false, totalResults: 50 })).toBeNull();
  });

  it("cannot continue a hasNext page that ships no cursor", () => {
    expect(nextPlaneListCursor({ nextCursor: null, hasNext: true, totalResults: 50 })).toBeNull();
  });

  it("handles a list with no pages yet", () => {
    expect(nextPlaneListCursor(null)).toBeNull();
  });
});

describe("filterPlaneTasks", () => {
  const tasks = [
    makeTask({ id: "a", priority: "urgent", stateId: "s1", assigneeIds: ["m1"] }),
    makeTask({ id: "b", priority: "low", stateId: "s2", assigneeIds: [] }),
    makeTask({ id: "c", priority: "urgent", stateId: "s1", assigneeIds: ["m1", "m2"] }),
  ];

  it("returns every task when nothing is filtered", () => {
    expect(
      filterPlaneTasks(tasks, { stateId: null, priority: null, assigneeId: null }),
    ).toHaveLength(3);
    expect(hasActivePlaneTaskFilters({ stateId: null, priority: null, assigneeId: null })).toBe(
      false,
    );
  });

  it("narrows by state, priority, and assignee together", () => {
    const filtered = filterPlaneTasks(tasks, {
      stateId: "s1",
      priority: "urgent",
      assigneeId: "m2",
    });
    expect(filtered.map((task) => task.id)).toEqual(["c"]);
  });

  it("keeps tasks with no state when only priority filters", () => {
    const noState = makeTask({ id: "d", priority: "low", stateId: null });
    const filtered = filterPlaneTasks([noState, ...tasks], {
      stateId: null,
      priority: "low",
      assigneeId: null,
    });
    expect(filtered.map((task) => task.id)).toEqual(["d", "b"]);
  });
});

describe("planeSearchView", () => {
  const hit = {
    id: "a",
    sequenceId: 3,
    name: "Hit",
    projectId: "project-1",
    projectIdentifier: "PROJ",
    url: "https://plane.example.com/ws/projects/project-1/issues/a/",
  };
  const result: PlaneSearchResult = { hits: [hit, hit], truncated: false, limit: 2 };

  it("caps visible hits and reports truncation", () => {
    const view = planeSearchView(result, 1);
    expect(view.hits).toHaveLength(1);
    expect(view.truncated).toBe(true);
  });

  it("passes the server's own truncation flag through", () => {
    const view = planeSearchView({ ...result, truncated: true }, 10);
    expect(view.hits).toHaveLength(2);
    expect(view.truncated).toBe(true);
  });

  it("leaves an uncapped result untruncated", () => {
    expect(planeSearchView(result, 10)).toEqual({ hits: result.hits, truncated: false });
  });
});

describe("selectPlaneEnvironment", () => {
  const candidates = [
    { id: "env-1", connected: true },
    { id: "env-2", connected: false },
  ];

  it("uses the primary environment when the route names none", () => {
    expect(selectPlaneEnvironment(null, "env-1", candidates)).toBe("env-1");
  });

  it("prefers the route's environment over the primary one", () => {
    expect(selectPlaneEnvironment("env-1", null, candidates)).toBe("env-1");
  });

  it("never falls back silently off a disconnected requested environment", () => {
    expect(selectPlaneEnvironment("env-2", "env-1", candidates)).toBeNull();
    expect(isDisconnectedEnvironmentRequest("env-2", candidates)).toBe(true);
  });

  it("returns nothing without a connected environment", () => {
    expect(selectPlaneEnvironment(null, "env-2", candidates)).toBeNull();
    expect(selectPlaneEnvironment(null, null, [])).toBeNull();
    expect(isDisconnectedEnvironmentRequest("env-3", candidates)).toBe(false);
  });
});

describe("metadata name mapping", () => {
  const metadata: PlaneProjectMetadata = {
    states: [{ id: "s1", name: "In Progress", color: "#ff0", group: "started" }],
    members: [{ id: "m1", displayName: "Ada Lovelace", avatarUrl: null }],
  };

  it("maps state ids to their states and members to display names", () => {
    expect(planeStateById(metadata, "s1")?.name).toBe("In Progress");
    expect(planeStateById(metadata, "missing")).toBeNull();
    expect(planeStateById(null, "s1")).toBeNull();
    expect(planeAssigneeNames(metadata, makeTask({ id: "a", assigneeIds: ["m1", "zz"] }))).toEqual([
      "Ada Lovelace",
      "zz",
    ]);
  });

  it("names comment actors through the member list", () => {
    expect(planeCommentActorName(metadata, "m1")).toBe("Ada Lovelace");
    expect(planeCommentActorName(metadata, null)).toBeNull();
    expect(planeCommentActorName(null, "m1")).toBe("m1");
  });
});

describe("presentation helpers", () => {
  it("reduces stored HTML to text for copy-content", () => {
    expect(planeHtmlToPlainText("<p>First</p><p>Second &amp; third</p>")).toBe(
      "First\nSecond & third",
    );
    expect(planeHtmlToPlainText("plain &amp; simple")).toBe("plain & simple");
    expect(planeHtmlToPlainText("<ul><li>One</li><li>Two</li></ul>")).toBe("- One\n- Two");
  });
});
