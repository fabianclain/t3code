import {
  planeProjectUrl,
  planeTaskUrl,
  type PlaneComment,
  type PlaneMember,
  type PlanePageInfo,
  type PlanePriority,
  type PlaneProject,
  type PlaneState,
  type PlaneTask,
  type PlaneTaskHit,
  PlaneValidationError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/** Joins the instance root with an API path such as `/workspaces/{slug}/projects/`. */
export const apiUrl = (connection: { readonly baseUrl: string }, path: string): string =>
  `${connection.baseUrl}/api/v1${path}`;

export const workspacePath = (slug: string, suffix: string): string =>
  `/workspaces/${encodeURIComponent(slug)}${suffix}`;

export const projectPath = (projectId: string, suffix: string): string =>
  `/projects/${encodeURIComponent(projectId)}${suffix}`;

const ApiIssue = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description_html: Schema.optionalKey(Schema.NullOr(Schema.String)),
  priority: Schema.optionalKey(Schema.NullOr(Schema.String)),
  sequence_id: Schema.Union([Schema.Number, Schema.String]),
  project: Schema.String,
  state: Schema.optionalKey(Schema.NullOr(Schema.String)),
  assignees: Schema.optionalKey(Schema.Array(Schema.String)),
  created_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
  updated_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

const ApiProject = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  identifier: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

const ApiState = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  color: Schema.optionalKey(Schema.NullOr(Schema.String)),
  group: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

const ApiMember = Schema.Struct({
  id: Schema.String,
  display_name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  first_name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  last_name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  avatar_url: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

const ApiComment = Schema.Struct({
  id: Schema.String,
  comment_html: Schema.optionalKey(Schema.NullOr(Schema.String)),
  actor: Schema.optionalKey(Schema.NullOr(Schema.String)),
  created_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

const ApiSearchHit = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  sequence_id: Schema.Union([Schema.Number, Schema.String]),
  project_id: Schema.String,
  project__identifier: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

const decodeApi = Schema.decodeUnknownEffect;

const malformed = (cause: unknown) => new PlaneValidationError({ status: null, cause });

const toSequenceId = (value: number | string): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && value.trim() !== "" ? parsed : null;
};

const toPriority = (value: string | null | undefined): PlanePriority =>
  value === "urgent" || value === "high" || value === "medium" || value === "low" ? value : "none";

const toMemberName = (member: typeof ApiMember.Type): string | null => {
  if (member.display_name !== null && member.display_name !== undefined) return member.display_name;
  const name = `${member.first_name ?? ""} ${member.last_name ?? ""}`.trim();
  return name === "" ? null : name;
};

/** The members endpoint answers a bare array instead of the cursor envelope. */
const decodeArrayPage = (
  input: unknown,
): Effect.Effect<
  { readonly items: ReadonlyArray<unknown> } & PlanePageInfo,
  PlaneValidationError
> =>
  decodeApi(Schema.Array(Schema.Unknown))(input).pipe(
    Effect.map((items) => ({
      items,
      nextCursor: null,
      hasNext: false,
      totalResults: items.length,
    })),
    Effect.mapError(malformed),
  );

/**
 * The API's cursor envelope. `next_page_results` is the only proof of another page; a cursor
 * alone is not. List endpoints answer with `results`; members answers a bare array, which
 * `decodePage` handles before this envelope is tried. Unknown keys are tolerated, but an
 * object without `results` is malformed, not an empty list.
 */
const decodePageEnvelope = decodeApi(
  Schema.Struct({
    results: Schema.Array(Schema.Unknown),
    total_results: Schema.optionalKey(Schema.Number),
    next_cursor: Schema.optionalKey(Schema.NullOr(Schema.String)),
    next_page_results: Schema.optionalKey(Schema.Boolean),
  }),
);

export const decodePage = (
  input: unknown,
): Effect.Effect<
  { readonly items: ReadonlyArray<unknown> } & PlanePageInfo,
  PlaneValidationError
> => {
  if (Array.isArray(input)) return decodeArrayPage(input);
  return decodePageEnvelope(input).pipe(
    Effect.map(({ results, total_results, next_cursor, next_page_results }) => ({
      items: results,
      nextCursor: next_cursor ?? null,
      hasNext: next_page_results === true,
      totalResults: total_results ?? null,
    })),
    Effect.mapError(malformed),
  );
};

// Per-item decodes run inside page loops; a span per item would be noise.
export const decodePlaneTask = Effect.fnUntraced(function* (
  input: unknown,
  connection: { readonly baseUrl: string; readonly workspaceSlug: string },
): Effect.fn.Return<PlaneTask, PlaneValidationError> {
  const api = yield* decodeApi(ApiIssue)(input).pipe(Effect.mapError(malformed));
  const sequenceId = toSequenceId(api.sequence_id);
  if (sequenceId === null) return yield* malformed(new Error("invalid sequence_id"));
  return {
    id: api.id,
    sequenceId,
    name: api.name,
    descriptionHtml: api.description_html ?? "",
    priority: toPriority(api.priority),
    projectId: api.project,
    stateId: api.state ?? null,
    assigneeIds: api.assignees ?? [],
    createdAt: api.created_at ?? null,
    updatedAt: api.updated_at ?? null,
    url: planeTaskUrl(connection, api.project, api.id),
  };
});

export const decodePlaneProject = (
  input: unknown,
  connection: { readonly baseUrl: string; readonly workspaceSlug: string },
): Effect.Effect<PlaneProject, PlaneValidationError> =>
  decodeApi(ApiProject)(input).pipe(
    Effect.map((api) => ({
      id: api.id,
      name: api.name,
      identifier: api.identifier ?? null,
      url: planeProjectUrl(connection, api.id),
    })),
    Effect.mapError(malformed),
  );

export const decodePlaneState = (input: unknown): Effect.Effect<PlaneState, PlaneValidationError> =>
  decodeApi(ApiState)(input).pipe(
    Effect.map((api) => ({
      id: api.id,
      name: api.name,
      color: api.color ?? null,
      group: api.group ?? "",
    })),
    Effect.mapError(malformed),
  );

export const decodePlaneMember = (
  input: unknown,
): Effect.Effect<PlaneMember, PlaneValidationError> =>
  decodeApi(ApiMember)(input).pipe(
    Effect.map((api) => ({
      id: api.id,
      displayName: toMemberName(api),
      avatarUrl: api.avatar_url ?? null,
    })),
    Effect.mapError(malformed),
  );

export const decodePlaneComment = (
  input: unknown,
): Effect.Effect<PlaneComment, PlaneValidationError> =>
  decodeApi(ApiComment)(input).pipe(
    Effect.map((api) => ({
      id: api.id,
      html: api.comment_html ?? "",
      actorId: api.actor ?? null,
      createdAt: api.created_at ?? null,
    })),
    Effect.mapError(malformed),
  );

export const decodePlaneTaskHit = Effect.fnUntraced(function* (
  input: unknown,
  connection: { readonly baseUrl: string; readonly workspaceSlug: string },
): Effect.fn.Return<PlaneTaskHit, PlaneValidationError> {
  const api = yield* decodeApi(ApiSearchHit)(input).pipe(Effect.mapError(malformed));
  const sequenceId = toSequenceId(api.sequence_id);
  if (sequenceId === null) return yield* malformed(new Error("invalid sequence_id"));
  return {
    id: api.id,
    sequenceId,
    name: api.name,
    projectId: api.project_id,
    projectIdentifier: api.project__identifier ?? null,
    url: planeTaskUrl(connection, api.project_id, api.id),
  };
});

export const decodeCurrentUser = Effect.fnUntraced(function* (
  input: unknown,
): Effect.fn.Return<
  { readonly userId: string; readonly displayName: string | null },
  PlaneValidationError
> {
  const api = yield* decodeApi(
    Schema.Struct({
      id: Schema.String,
      display_name: Schema.optionalKey(Schema.NullOr(Schema.String)),
      first_name: Schema.optionalKey(Schema.NullOr(Schema.String)),
      last_name: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
  )(input).pipe(Effect.mapError(malformed));
  const fallback = `${api.first_name ?? ""} ${api.last_name ?? ""}`.trim();
  return { userId: api.id, displayName: api.display_name ?? (fallback === "" ? null : fallback) };
});

/** Builds a Plane API query string; absent and empty parameters are omitted. */
export const apiQuery = (parameters: Record<string, string | number | undefined>): string => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (value === undefined || value === "") continue;
    query.set(key, String(value));
  }
  const encoded = query.toString();
  return encoded === "" ? "" : `?${encoded}`;
};
