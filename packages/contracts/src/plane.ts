import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString, TrimmedString } from "./baseSchemas.ts";
import { SettingsSecretValue } from "./settingsSecretValue.ts";

/**
 * Connection to one self-hosted Plane instance. The token is a credential: stored in the
 * server's secret store (or named through a secret provider) and redacted for clients.
 * `baseUrl` may be the instance root or a full workspace URL; the slug is derived from it
 * when the field here is empty.
 */
export const PlaneSettings = Schema.Struct({
  baseUrl: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  workspaceSlug: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  apiToken: SettingsSecretValue.pipe(Schema.withDecodingDefaultKey(Effect.succeed(""))),
});
export type PlaneSettings = typeof PlaneSettings.Type;

const PLANE_MAX_PER_PAGE = 100;
export const PLANE_DEFAULT_PER_PAGE = 50;
export const PLANE_MAX_SEARCH_RESULTS = PLANE_MAX_PER_PAGE;

export const PlanePerPage = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: PLANE_MAX_PER_PAGE }),
);
export type PlanePerPage = typeof PlanePerPage.Type;

export interface PlaneConnection {
  /** Instance root without a trailing slash, including any deployment subpath. */
  readonly baseUrl: string;
  /** Null when the URL alone does not name a workspace and none was configured. */
  readonly workspaceSlug: string | null;
}

/**
 * Resolves the instance root and workspace from a saved connection. A `baseUrl` that is a
 * full workspace URL (`https://host/{slug}` or a copied task link under a subpath) derives
 * the slug and keeps only the path before it; an explicit slug wins and is stripped from the
 * base path when the URL repeats it.
 */
export function parsePlaneConnection(
  baseUrl: string,
  workspaceSlug: string,
): PlaneConnection | null {
  const url = URL.parse(baseUrl.trim());
  if (url === null || (url.protocol !== "https:" && url.protocol !== "http:")) return null;
  const segments = url.pathname.split("/").filter((segment) => segment !== "");
  const slug = workspaceSlug.trim();
  if (slug !== "") {
    const slugIndex = segments.indexOf(slug);
    const baseSegments = slugIndex >= 0 ? segments.slice(0, slugIndex) : segments;
    return {
      baseUrl: `${url.origin}${baseSegments.length > 0 ? `/${baseSegments.join("/")}` : ""}`,
      workspaceSlug: slug,
    };
  }
  // A copied task link marks its workspace by the segment before "projects".
  const projectsIndex = segments.indexOf("projects");
  if (projectsIndex > 0) {
    return {
      baseUrl: `${url.origin}${projectsIndex > 1 ? `/${segments.slice(0, projectsIndex - 1).join("/")}` : ""}`,
      workspaceSlug: segments[projectsIndex - 1]!,
    };
  }
  if (segments.length > 0) {
    return { baseUrl: url.origin, workspaceSlug: segments[0]! };
  }
  return { baseUrl: url.origin, workspaceSlug: null };
}

/** Canonical web link to a task. Isolated here so a route change is one edit. */
export function planeTaskUrl(
  connection: { readonly baseUrl: string; readonly workspaceSlug: string },
  projectId: string,
  taskId: string,
): string {
  return `${connection.baseUrl}/${connection.workspaceSlug}/projects/${projectId}/issues/${taskId}/`;
}

export function planeProjectUrl(
  connection: { readonly baseUrl: string; readonly workspaceSlug: string },
  projectId: string,
): string {
  return `${connection.baseUrl}/${connection.workspaceSlug}/projects/${projectId}/`;
}

export const PlanePriority = Schema.Literals(["urgent", "high", "medium", "low", "none"]);
export type PlanePriority = typeof PlanePriority.Type;

export const PlaneState = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  color: Schema.NullOr(Schema.String),
  group: Schema.String,
});
export type PlaneState = typeof PlaneState.Type;

/** A workspace member without their email; display names suffice for assignment UI. */
export const PlaneMember = Schema.Struct({
  id: Schema.String,
  displayName: Schema.NullOr(Schema.String),
  avatarUrl: Schema.NullOr(Schema.String),
});
export type PlaneMember = typeof PlaneMember.Type;

export const PlaneProject = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  identifier: Schema.NullOr(Schema.String),
  url: Schema.String,
});
export type PlaneProject = typeof PlaneProject.Type;

export const PlaneTask = Schema.Struct({
  id: Schema.String,
  sequenceId: Schema.Number,
  name: Schema.String,
  descriptionHtml: Schema.String,
  priority: PlanePriority,
  projectId: Schema.String,
  stateId: Schema.NullOr(Schema.String),
  assigneeIds: Schema.Array(Schema.String),
  createdAt: Schema.NullOr(Schema.String),
  updatedAt: Schema.NullOr(Schema.String),
  url: Schema.String,
});
export type PlaneTask = typeof PlaneTask.Type;

/** A search hit carries list columns only; fetch the task for detail. */
export const PlaneTaskHit = Schema.Struct({
  id: Schema.String,
  sequenceId: Schema.Number,
  name: Schema.String,
  projectId: Schema.String,
  projectIdentifier: Schema.NullOr(Schema.String),
  url: Schema.String,
});
export type PlaneTaskHit = typeof PlaneTaskHit.Type;

export const PlaneComment = Schema.Struct({
  id: Schema.String,
  html: Schema.String,
  actorId: Schema.NullOr(Schema.String),
  createdAt: Schema.NullOr(Schema.String),
});
export type PlaneComment = typeof PlaneComment.Type;

/** One fetched page. `hasNext` comes from the API's own boolean; a cursor alone is not proof. */
export const PlanePageInfo = Schema.Struct({
  nextCursor: Schema.NullOr(Schema.String),
  hasNext: Schema.Boolean,
  totalResults: Schema.NullOr(Schema.Number),
});
export type PlanePageInfo = typeof PlanePageInfo.Type;

export const PlaneConnectionStatus = Schema.Struct({
  configured: Schema.Boolean,
  baseUrl: Schema.NullOr(Schema.String),
  workspaceSlug: Schema.NullOr(Schema.String),
});
export type PlaneConnectionStatus = typeof PlaneConnectionStatus.Type;

export const PlaneTestConnectionResult = Schema.Struct({
  workspaceSlug: Schema.String,
  userId: Schema.String,
  displayName: Schema.NullOr(Schema.String),
});
export type PlaneTestConnectionResult = typeof PlaneTestConnectionResult.Type;

export const PlaneProjectsResult = Schema.Struct({
  projects: Schema.Array(PlaneProject),
  page: PlanePageInfo,
});
export type PlaneProjectsResult = typeof PlaneProjectsResult.Type;

export const PlaneProjectMetadata = Schema.Struct({
  states: Schema.Array(PlaneState),
  members: Schema.Array(PlaneMember),
});
export type PlaneProjectMetadata = typeof PlaneProjectMetadata.Type;

export const PlaneTasksResult = Schema.Struct({
  tasks: Schema.Array(PlaneTask),
  page: PlanePageInfo,
});
export type PlaneTasksResult = typeof PlaneTasksResult.Type;

/**
 * Search is the API's bounded endpoint: at most `limit` hits per call, matched by name,
 * sequence number, and project identifier. `truncated` reports that the cap was reached,
 * so more tasks may match than are returned.
 */
export const PlaneSearchResult = Schema.Struct({
  hits: Schema.Array(PlaneTaskHit),
  truncated: Schema.Boolean,
  limit: Schema.Number,
});
export type PlaneSearchResult = typeof PlaneSearchResult.Type;

export const PlaneCommentsResult = Schema.Struct({
  comments: Schema.Array(PlaneComment),
  page: PlanePageInfo,
});
export type PlaneCommentsResult = typeof PlaneCommentsResult.Type;

export class PlaneNotConfiguredError extends Schema.TaggedError<PlaneNotConfiguredError>()(
  "PlaneNotConfiguredError",
  {
    reason: Schema.Literals([
      "missing-connection",
      "invalid-url",
      "missing-workspace",
      "missing-token",
    ]),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "invalid-url":
        return "The Plane URL is not a valid http(s) URL. Check the connection settings.";
      case "missing-workspace":
        return "The Plane workspace is not set and the URL does not name one.";
      case "missing-token":
        return "The Plane API token is not set. Save it in the connection settings.";
      default:
        return "No Plane connection is configured. Set it up in the connection settings.";
    }
  }
}

export class PlaneUnauthorizedError extends Schema.TaggedError<PlaneUnauthorizedError>()(
  "PlaneUnauthorizedError",
  {},
) {
  override get message(): string {
    // 401 means a bad token; 403 can equally mean the token is valid but denied on the
    // workspace or project, so the message must not claim the token alone is at fault.
    return "Plane rejected the API token or its workspace/project access. Check the token and permissions in the connection settings.";
  }
}

export class PlaneNotFoundError extends Schema.TaggedError<PlaneNotFoundError>()(
  "PlaneNotFoundError",
  { resource: Schema.Literals(["workspace", "project", "task"]) },
) {
  override get message(): string {
    return `The Plane ${this.resource} was not found. Check the connection settings and project.`;
  }
}

export class PlaneUnavailableError extends Schema.TaggedError<PlaneUnavailableError>()(
  "PlaneUnavailableError",
  {
    reason: Schema.Literals(["network", "timeout", "bad-response"]),
    status: Schema.optionalKey(Schema.Number),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "timeout":
        return "The Plane request timed out.";
      case "bad-response":
        return `Plane is not responding correctly (HTTP ${this.status ?? "error"}).`;
      default:
        return "Plane could not be reached.";
    }
  }
}

export class PlaneRateLimitedError extends Schema.TaggedError<PlaneRateLimitedError>()(
  "PlaneRateLimitedError",
  { retryAfterSeconds: Schema.NullOr(Schema.Number) },
) {
  override get message(): string {
    return this.retryAfterSeconds === null
      ? "Plane is rate limiting requests. Try again shortly."
      : `Plane is rate limiting requests. Try again in ${this.retryAfterSeconds}s.`;
  }
}

export class PlaneValidationError extends Schema.TaggedError<PlaneValidationError>()(
  "PlaneValidationError",
  {
    /** Null when a response body could not be parsed rather than rejected with a status. */
    status: Schema.NullOr(Schema.Number),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.status === null
      ? "Plane returned an unreadable response."
      : `Plane rejected the request (HTTP ${this.status}).`;
  }
}

export const PlaneError = Schema.Union([
  PlaneNotConfiguredError,
  PlaneUnauthorizedError,
  PlaneNotFoundError,
  PlaneUnavailableError,
  PlaneRateLimitedError,
  PlaneValidationError,
]);
export type PlaneError = typeof PlaneError.Type;

export const PlaneConnectionStatusInput = Schema.Struct({});

export const PlaneListProjectsInput = Schema.Struct({
  cursor: Schema.optionalKey(Schema.String),
  perPage: Schema.optionalKey(PlanePerPage),
});

export const PlaneProjectInput = Schema.Struct({
  projectId: Schema.String,
});

export const PlaneListTasksInput = Schema.Struct({
  projectId: Schema.String,
  cursor: Schema.optionalKey(Schema.String),
  perPage: Schema.optionalKey(PlanePerPage),
});

export const PlaneSearchTasksInput = Schema.Struct({
  projectId: Schema.String,
  query: TrimmedNonEmptyString,
  limit: Schema.optionalKey(PlanePerPage),
});

export const PlaneTaskInput = Schema.Struct({
  projectId: Schema.String,
  taskId: Schema.String,
});

export const PlaneListCommentsInput = Schema.Struct({
  projectId: Schema.String,
  taskId: Schema.String,
  cursor: Schema.optionalKey(Schema.String),
  perPage: Schema.optionalKey(PlanePerPage),
});

/** Only the fields a client provides are sent to Plane; everything else keeps its value. */
export const PlaneCreateTaskInput = Schema.Struct({
  projectId: Schema.String,
  name: TrimmedNonEmptyString,
  descriptionHtml: Schema.optionalKey(Schema.String),
  priority: Schema.optionalKey(PlanePriority),
  stateId: Schema.optionalKey(Schema.String),
  assigneeIds: Schema.optionalKey(Schema.Array(Schema.String)),
});

export const PlaneUpdateTaskInput = Schema.Struct({
  projectId: Schema.String,
  taskId: Schema.String,
  name: Schema.optionalKey(TrimmedNonEmptyString),
  descriptionHtml: Schema.optionalKey(Schema.String),
  priority: Schema.optionalKey(PlanePriority),
  stateId: Schema.optionalKey(Schema.String),
  assigneeIds: Schema.optionalKey(Schema.Array(Schema.String)),
});

export const PlaneAddCommentInput = Schema.Struct({
  projectId: Schema.String,
  taskId: Schema.String,
  html: TrimmedNonEmptyString,
});
