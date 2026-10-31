import {
  isSecretReference,
  PlaneAddCommentInput,
  PlaneComment,
  PlaneCommentsResult,
  PlaneConnectionStatus,
  PlaneConnectionStatusInput,
  PlaneCreateTaskInput,
  PlaneError,
  PlaneListCommentsInput,
  PlaneListProjectsInput,
  PlaneListTasksInput,
  PlaneNotFoundError,
  PlaneNotConfiguredError,
  PlaneProjectInput,
  PlaneProjectMetadata,
  PlaneProjectsResult,
  PlaneRateLimitedError,
  PlaneSearchResult,
  PlaneSearchTasksInput,
  PlaneSettings,
  PlaneTask,
  PlaneTaskInput,
  PlaneTasksResult,
  PlaneTestConnectionResult,
  PlaneUnauthorizedError,
  PlaneUnavailableError,
  PlaneUpdateTaskInput,
  PlaneValidationError,
  PLANE_DEFAULT_PER_PAGE,
  PLANE_MAX_SEARCH_RESULTS,
  parsePlaneConnection,
  settingsSecretLiteral,
  type PlanePageInfo,
} from "@t3tools/contracts";
import * as ByteSize from "effect/ByteSize";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as SecretResolver from "@t3tools/secret-provider-core/server/SecretResolver";
import { resolveSettingsSecrets } from "../secrets/settingsSecretValue.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as planeApi from "./planeApi.ts";

const READ_TIMEOUT = Duration.seconds(15);
const WRITE_TIMEOUT = Duration.seconds(30);
/** A full page of tasks with rich HTML descriptions stays well below this. */
const MAX_RESPONSE_BYTES = ByteSize.megabytes(8);
const MAX_RESPONSE_BYTES_NUMBER = Number(MAX_RESPONSE_BYTES);

// Browse pages ask upstream for list columns only; description_html stays out so a page of
// tasks does not duplicate rich HTML. Live v1 honours this projection; the detail RPC and
// writes still return the full task.
const BROWSE_TASK_FIELDS =
  "id,name,priority,sequence_id,project,state,assignees,created_at,updated_at";

const decodeJsonText = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeSearchEnvelope = Schema.decodeUnknownEffect(
  Schema.Struct({ issues: Schema.Array(Schema.Unknown) }),
);

export class PlaneService extends Context.Service<
  PlaneService,
  {
    /** Local settings read; never contacts Plane. */
    readonly connectionStatus: Effect.Effect<PlaneConnectionStatus>;

    readonly testConnection: (
      input: typeof PlaneConnectionStatusInput.Type,
    ) => Effect.Effect<PlaneTestConnectionResult, PlaneError>;

    readonly listProjects: (
      input: typeof PlaneListProjectsInput.Type,
    ) => Effect.Effect<PlaneProjectsResult, PlaneError>;

    readonly projectMetadata: (
      input: typeof PlaneProjectInput.Type,
    ) => Effect.Effect<PlaneProjectMetadata, PlaneError>;

    readonly listTasks: (
      input: typeof PlaneListTasksInput.Type,
    ) => Effect.Effect<PlaneTasksResult, PlaneError>;

    readonly searchTasks: (
      input: typeof PlaneSearchTasksInput.Type,
    ) => Effect.Effect<PlaneSearchResult, PlaneError>;

    readonly getTask: (input: typeof PlaneTaskInput.Type) => Effect.Effect<PlaneTask, PlaneError>;

    readonly listComments: (
      input: typeof PlaneListCommentsInput.Type,
    ) => Effect.Effect<PlaneCommentsResult, PlaneError>;

    readonly createTask: (
      input: typeof PlaneCreateTaskInput.Type,
    ) => Effect.Effect<PlaneTask, PlaneError>;

    readonly updateTask: (
      input: typeof PlaneUpdateTaskInput.Type,
    ) => Effect.Effect<PlaneTask, PlaneError>;

    readonly addComment: (
      input: typeof PlaneAddCommentInput.Type,
    ) => Effect.Effect<PlaneComment, PlaneError>;
  }
>()("t3/plane/PlaneService") {}

interface ResolvedConnection {
  readonly baseUrl: string;
  readonly workspaceSlug: string;
  readonly token: string;
}

interface RequestOptions {
  readonly method: "GET" | "POST" | "PATCH";
  readonly url: string;
  readonly token: string;
  readonly body?: unknown;
  readonly write: boolean;
  readonly notFound: "workspace" | "project" | "task";
}

const make = Effect.gen(function* () {
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const secretResolver = yield* SecretResolver.SecretResolver;
  const http = yield* HttpClient.HttpClient;

  const resolveConnection = Effect.fn("PlaneService.resolveConnection")(
    function* (): Effect.fn.Return<ResolvedConnection, PlaneNotConfiguredError> {
      const section = (yield* serverSettings.getSettings.pipe(Effect.orDie)).plane;
      if (section === null) {
        return yield* new PlaneNotConfiguredError({ reason: "missing-connection" });
      }
      const connection = parsePlaneConnection(section.baseUrl, section.workspaceSlug);
      if (connection === null) {
        return yield* new PlaneNotConfiguredError({ reason: "invalid-url" });
      }
      if (connection.workspaceSlug === null) {
        return yield* new PlaneNotConfiguredError({ reason: "missing-workspace" });
      }
      // A secret-provider reference is not materialized by the settings snapshot; read it here.
      const withToken = isSecretReference(section.apiToken)
        ? yield* resolveSettingsSecrets(secretResolver, PlaneSettings, section)
        : section;
      const token = settingsSecretLiteral(withToken.apiToken);
      if (token === "") {
        return yield* new PlaneNotConfiguredError({ reason: "missing-token" });
      }
      return {
        baseUrl: connection.baseUrl,
        workspaceSlug: connection.workspaceSlug,
        token,
      };
    },
  );

  // An unreadable or over-limit body is a typed failure with nothing raw attached: a decode
  // defect would carry the request, whose headers hold the token.
  const unreadableResponse = () => new PlaneValidationError({ status: null });

  const headerBytes = (value: string | undefined): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
  };

  const requestJson = Effect.fnUntraced(function* (
    options: RequestOptions,
  ): Effect.fn.Return<unknown, PlaneError> {
    // One request per service operation; shares the operation's span instead of adding one.
    let request = HttpClientRequest.make(options.method)(options.url).pipe(
      HttpClientRequest.setHeader("x-api-key", options.token),
      HttpClientRequest.setHeader("accept", "application/json"),
    );
    if (options.body !== undefined) {
      request = yield* HttpClientRequest.bodyJson(options.body)(request).pipe(Effect.orDie);
    }
    const response = yield* http.execute(request).pipe(
      Effect.provideService(HttpIncomingMessage.MaxBodySize, MAX_RESPONSE_BYTES),
      Effect.timeout(options.write ? WRITE_TIMEOUT : READ_TIMEOUT),
      Effect.mapError((cause): PlaneError =>
        Cause.isTimeoutError(cause)
          ? new PlaneUnavailableError({ reason: "timeout" })
          : new PlaneUnavailableError({ reason: "network", cause }),
      ),
    );
    if (response.status === 401 || response.status === 403) {
      return yield* new PlaneUnauthorizedError();
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers["retry-after"]);
      return yield* new PlaneRateLimitedError({
        retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : null,
      });
    }
    if (response.status === 404) {
      return yield* new PlaneNotFoundError({ resource: options.notFound });
    }
    if (response.status === 400 || response.status === 422) {
      return yield* new PlaneValidationError({ status: response.status });
    }
    if (response.status < 200 || response.status >= 300) {
      return yield* new PlaneUnavailableError({ reason: "bad-response", status: response.status });
    }
    // The size bound must be in scope while the body is read, not only while the call is
    // made; a declared oversize body is rejected before reading.
    if (headerBytes(response.headers["content-length"]) > MAX_RESPONSE_BYTES_NUMBER) {
      return yield* unreadableResponse();
    }
    const text = yield* response.text.pipe(
      Effect.provideService(HttpIncomingMessage.MaxBodySize, MAX_RESPONSE_BYTES),
      Effect.timeout(options.write ? WRITE_TIMEOUT : READ_TIMEOUT),
      Effect.mapError((cause): PlaneError =>
        Cause.isTimeoutError(cause)
          ? new PlaneUnavailableError({ reason: "timeout" })
          : unreadableResponse(),
      ),
    );
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES_NUMBER) {
      return yield* unreadableResponse();
    }
    return yield* decodeJsonText(text).pipe(Effect.mapError(() => unreadableResponse()));
  });

  const decodeItems = <A>(
    json: unknown,
    decodeItem: (item: unknown) => Effect.Effect<A, PlaneValidationError>,
  ): Effect.Effect<
    { readonly items: ReadonlyArray<A>; readonly page: PlanePageInfo },
    PlaneValidationError
  > =>
    planeApi
      .decodePage(json)
      .pipe(
        Effect.flatMap(({ items, ...page }) =>
          Effect.forEach(items, decodeItem).pipe(
            Effect.map((decoded) => ({ items: decoded, page })),
          ),
        ),
      );

  const workspacePath = (connection: ResolvedConnection, suffix: string) =>
    planeApi.workspacePath(connection.workspaceSlug, suffix);

  const projectUrl = (
    connection: ResolvedConnection,
    projectId: string,
    suffix: string,
    query: Record<string, string | number | undefined> = {},
  ) =>
    planeApi.apiUrl(
      connection,
      workspacePath(connection, planeApi.projectPath(projectId, suffix)),
    ) + planeApi.apiQuery(query);

  const connectionStatus = Effect.gen(function* (): Effect.fn.Return<PlaneConnectionStatus> {
    const section = (yield* serverSettings.getSettings.pipe(Effect.orDie)).plane;
    if (section === null) {
      return { configured: false, baseUrl: null, workspaceSlug: null };
    }
    const connection = parsePlaneConnection(section.baseUrl, section.workspaceSlug);
    const workspaceSlug = connection?.workspaceSlug ?? null;
    const hasToken = typeof section.apiToken === "string" ? section.apiToken !== "" : true;
    const configured = connection !== null && workspaceSlug !== null && hasToken;
    return {
      configured,
      baseUrl: configured && connection !== null ? connection.baseUrl : null,
      workspaceSlug: configured ? workspaceSlug : null,
    };
  }).pipe(Effect.withSpan("PlaneService.connectionStatus"));

  const testConnection = Effect.fn("PlaneService.testConnection")(function* (
    _input: typeof PlaneConnectionStatusInput.Type,
  ): Effect.fn.Return<PlaneTestConnectionResult, PlaneError> {
    const connection = yield* resolveConnection();
    const user = yield* planeApi.decodeCurrentUser(
      yield* requestJson({
        method: "GET",
        url: planeApi.apiUrl(connection, "/users/me/"),
        token: connection.token,
        write: false,
        notFound: "workspace",
      }),
    );
    // Proves the workspace slug resolves on this instance, not just that the token is valid.
    yield* requestJson({
      method: "GET",
      url: planeApi.apiUrl(connection, workspacePath(connection, "/projects/")),
      token: connection.token,
      write: false,
      notFound: "workspace",
    });
    return {
      workspaceSlug: connection.workspaceSlug,
      userId: user.userId,
      displayName: user.displayName,
    };
  });

  const listProjects = Effect.fn("PlaneService.listProjects")(function* (
    input: typeof PlaneListProjectsInput.Type,
  ): Effect.fn.Return<PlaneProjectsResult, PlaneError> {
    const connection = yield* resolveConnection();
    const json = yield* requestJson({
      method: "GET",
      url:
        planeApi.apiUrl(connection, workspacePath(connection, "/projects/")) +
        planeApi.apiQuery({
          cursor: input.cursor,
          per_page: input.perPage ?? PLANE_DEFAULT_PER_PAGE,
        }),
      token: connection.token,
      write: false,
      notFound: "workspace",
    });
    const decoded = yield* decodeItems(json, (item) =>
      planeApi.decodePlaneProject(item, connection),
    );
    return { projects: decoded.items, page: decoded.page };
  });

  const projectMetadata = Effect.fn("PlaneService.projectMetadata")(function* (
    input: typeof PlaneProjectInput.Type,
  ): Effect.fn.Return<PlaneProjectMetadata, PlaneError> {
    const connection = yield* resolveConnection();
    // Metadata lists are small; cap them at the API's page maximum instead of following cursors.
    const perPage = { per_page: PLANE_MAX_SEARCH_RESULTS };
    const [states, members] = yield* Effect.all(
      [
        requestJson({
          method: "GET",
          url: projectUrl(connection, input.projectId, "/states/", perPage),
          token: connection.token,
          write: false,
          notFound: "project",
        }).pipe(
          Effect.flatMap((json) => decodeItems(json, planeApi.decodePlaneState)),
          Effect.map((decoded) => decoded.items),
        ),
        requestJson({
          method: "GET",
          url: projectUrl(connection, input.projectId, "/members/", perPage),
          token: connection.token,
          write: false,
          notFound: "project",
        }).pipe(
          Effect.flatMap((json) => decodeItems(json, planeApi.decodePlaneMember)),
          Effect.map((decoded) => decoded.items),
        ),
      ],
      { concurrency: 2 },
    );
    return { states, members };
  });

  const listTasks = Effect.fn("PlaneService.listTasks")(function* (
    input: typeof PlaneListTasksInput.Type,
  ): Effect.fn.Return<PlaneTasksResult, PlaneError> {
    const connection = yield* resolveConnection();
    const json = yield* requestJson({
      method: "GET",
      url: projectUrl(connection, input.projectId, "/issues/", {
        cursor: input.cursor,
        per_page: input.perPage ?? PLANE_DEFAULT_PER_PAGE,
        fields: BROWSE_TASK_FIELDS,
      }),
      token: connection.token,
      write: false,
      notFound: "project",
    });
    const decoded = yield* decodeItems(json, (item) => planeApi.decodePlaneTask(item, connection));
    return { tasks: decoded.items, page: decoded.page };
  });

  const searchTasks = Effect.fn("PlaneService.searchTasks")(function* (
    input: typeof PlaneSearchTasksInput.Type,
  ): Effect.fn.Return<PlaneSearchResult, PlaneError> {
    const connection = yield* resolveConnection();
    const limit = input.limit ?? PLANE_MAX_SEARCH_RESULTS;
    const json = yield* requestJson({
      method: "GET",
      url:
        planeApi.apiUrl(connection, workspacePath(connection, "/issues/search/")) +
        planeApi.apiQuery({ search: input.query, project_id: input.projectId, limit }),
      token: connection.token,
      write: false,
      notFound: "workspace",
    });
    const hits = yield* decodeSearchEnvelope(json).pipe(
      Effect.mapError((cause) => new PlaneValidationError({ status: null, cause })),
      Effect.flatMap(({ issues }) =>
        Effect.forEach(issues, (hit) => planeApi.decodePlaneTaskHit(hit, connection)),
      ),
    );
    return { hits, truncated: hits.length >= limit, limit };
  });

  const getTask = Effect.fn("PlaneService.getTask")(function* (
    input: typeof PlaneTaskInput.Type,
  ): Effect.fn.Return<PlaneTask, PlaneError> {
    const connection = yield* resolveConnection();
    const json = yield* requestJson({
      method: "GET",
      url: projectUrl(connection, input.projectId, `/issues/${encodeURIComponent(input.taskId)}/`),
      token: connection.token,
      write: false,
      notFound: "task",
    });
    return yield* planeApi.decodePlaneTask(json, connection);
  });

  const listComments = Effect.fn("PlaneService.listComments")(function* (
    input: typeof PlaneListCommentsInput.Type,
  ): Effect.fn.Return<PlaneCommentsResult, PlaneError> {
    const connection = yield* resolveConnection();
    const json = yield* requestJson({
      method: "GET",
      url: projectUrl(
        connection,
        input.projectId,
        `/issues/${encodeURIComponent(input.taskId)}/comments/`,
        {
          cursor: input.cursor,
          per_page: input.perPage ?? PLANE_DEFAULT_PER_PAGE,
        },
      ),
      token: connection.token,
      write: false,
      notFound: "task",
    });
    const decoded = yield* decodeItems(json, planeApi.decodePlaneComment);
    return { comments: decoded.items, page: decoded.page };
  });

  // Only the fields the caller provides are serialized; untouched values stay untouched on Plane.
  const taskWriteBody = (input: {
    readonly name?: string | undefined;
    readonly descriptionHtml?: string | undefined;
    readonly priority?: (typeof PlaneCreateTaskInput.Type)["priority"] | undefined;
    readonly stateId?: string | undefined;
    readonly assigneeIds?: ReadonlyArray<string> | undefined;
  }) => ({
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.descriptionHtml !== undefined ? { description_html: input.descriptionHtml } : {}),
    ...(input.priority !== undefined ? { priority: input.priority } : {}),
    ...(input.stateId !== undefined ? { state: input.stateId } : {}),
    ...(input.assigneeIds !== undefined ? { assignees: input.assigneeIds } : {}),
  });

  const createTask = Effect.fn("PlaneService.createTask")(function* (
    input: typeof PlaneCreateTaskInput.Type,
  ): Effect.fn.Return<PlaneTask, PlaneError> {
    const connection = yield* resolveConnection();
    const json = yield* requestJson({
      method: "POST",
      url: projectUrl(connection, input.projectId, "/issues/"),
      token: connection.token,
      body: taskWriteBody(input),
      write: true,
      notFound: "project",
    });
    return yield* planeApi.decodePlaneTask(json, connection);
  });

  const updateTask = Effect.fn("PlaneService.updateTask")(function* (
    input: typeof PlaneUpdateTaskInput.Type,
  ): Effect.fn.Return<PlaneTask, PlaneError> {
    const connection = yield* resolveConnection();
    const json = yield* requestJson({
      method: "PATCH",
      url: projectUrl(connection, input.projectId, `/issues/${encodeURIComponent(input.taskId)}/`),
      token: connection.token,
      body: taskWriteBody(input),
      write: true,
      notFound: "task",
    });
    return yield* planeApi.decodePlaneTask(json, connection);
  });

  const addComment = Effect.fn("PlaneService.addComment")(function* (
    input: typeof PlaneAddCommentInput.Type,
  ): Effect.fn.Return<PlaneComment, PlaneError> {
    const connection = yield* resolveConnection();
    const json = yield* requestJson({
      method: "POST",
      url: projectUrl(
        connection,
        input.projectId,
        `/issues/${encodeURIComponent(input.taskId)}/comments/`,
      ),
      token: connection.token,
      body: { comment_html: input.html },
      write: true,
      notFound: "task",
    });
    return yield* planeApi.decodePlaneComment(json);
  });

  return PlaneService.of({
    connectionStatus,
    testConnection,
    listProjects,
    projectMetadata,
    listTasks,
    searchTasks,
    getTask,
    listComments,
    createTask,
    updateTask,
    addComment,
  });
});

export const layer = Layer.effect(PlaneService, make);
