import * as NodeServices from "@effect/platform-node/NodeServices";
import { SecretProviderId, type ServerSettingsPatch } from "@t3tools/contracts";
import { assert, describe, expect, it } from "@effect/vitest";
import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import * as SecretResolver from "@t3tools/secret-provider-core/server/SecretResolver";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { SECRET_REDACTED } from "../settingsSecrets.ts";
import * as ServerSettingsModule from "../serverSettings.ts";
import * as PlaneService from "./PlaneService.ts";

const issue = (overrides: Record<string, unknown> = {}) => ({
  id: "task-1",
  name: "Ship the thing",
  description_html: "<p>Body</p>",
  priority: "high",
  sequence_id: 128,
  project: "proj-1",
  state: "state-1",
  assignees: ["user-1"],
  created_at: "2026-10-31T00:00:00Z",
  updated_at: "2026-10-31T01:00:00Z",
  ...overrides,
});

const project = { id: "proj-1", name: "Alpha", identifier: "ALPHA" };

interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly apiKey: string;
  readonly body: string;
}

interface StubResponse {
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
}

const decodeBody = (request: HttpClientRequest.HttpClientRequest): string => {
  const body = request.body;
  return body._tag === "Uint8Array" && body.text !== undefined ? body.text : "";
};

/** One layer-wide stub whose next response the test rewrites between calls. */
const scripted = () => {
  const requests: Array<CapturedRequest> = [];
  let next: StubResponse = { status: 200, body: {} };
  const httpClient = HttpClient.make((request) => {
    requests.push({
      url: request.url,
      method: request.method,
      apiKey: request.headers["x-api-key"] ?? "",
      body: decodeBody(request),
    });
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify(next.body), {
          status: next.status,
          ...(next.headers !== undefined ? { headers: next.headers } : {}),
        }),
      ),
    );
  });
  return { requests, httpClient, respondNext: (response: StubResponse) => (next = response) };
};

/** Answers each request with the next response, repeating the last one. */
const respondWith = (responses: ReadonlyArray<StubResponse>) => {
  const requests: Array<CapturedRequest> = [];
  let index = 0;
  const httpClient = HttpClient.make((request) => {
    requests.push({
      url: request.url,
      method: request.method,
      apiKey: request.headers["x-api-key"] ?? "",
      body: decodeBody(request),
    });
    const response = responses[Math.min(index, responses.length - 1)]!;
    index++;
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify(response.body), {
          status: response.status,
          ...(response.headers !== undefined ? { headers: response.headers } : {}),
        }),
      ),
    );
  });
  return { requests, httpClient };
};

const respond = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  respondWith([{ status, body, headers }]);

const hang = () => {
  const requests: Array<CapturedRequest> = [];
  const httpClient = HttpClient.make((request) => {
    requests.push({
      url: request.url,
      method: request.method,
      apiKey: request.headers["x-api-key"] ?? "",
      body: decodeBody(request),
    });
    return Effect.never;
  });
  return { requests, httpClient };
};

const failNetwork = () => {
  const requests: Array<CapturedRequest> = [];
  const httpClient = HttpClient.make((request) => {
    requests.push({
      url: request.url,
      method: request.method,
      apiKey: request.headers["x-api-key"] ?? "",
      body: decodeBody(request),
    });
    return Effect.fail(
      new HttpClientError.HttpClientError({
        reason: new HttpClientError.TransportError({ request }),
      }),
    );
  });
  return { requests, httpClient };
};

const layerSettings = () =>
  ServerSettingsModule.layer.pipe(
    Layer.provideMerge(ServerSecretStore.layer),
    Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
    Layer.provideMerge(
      Layer.fresh(ServerConfig.layerTest(process.cwd(), { prefix: "t3code-plane-service-test-" })),
    ),
  );

const noSecretReferences = {
  read: () => Effect.succeed([] as ReadonlyArray<string | undefined>),
  invalidate: () => Effect.void,
};

const layerPlane = (httpClient: HttpClient.HttpClient) =>
  PlaneService.layer.pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, httpClient)),
    Layer.provide(Layer.succeed(SecretResolver.SecretResolver, noSecretReferences)),
    Layer.provideMerge(layerSettings()),
    Layer.provideMerge(NodeServices.layer),
  );

const layerPlaneWithSecretResolver = (
  httpClient: HttpClient.HttpClient,
  read: SecretResolver.SecretResolver["Service"]["read"],
) =>
  PlaneService.layer.pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, httpClient)),
    Layer.provide(
      Layer.succeed(SecretResolver.SecretResolver, { read, invalidate: () => Effect.void }),
    ),
    Layer.provideMerge(layerSettings()),
    Layer.provideMerge(NodeServices.layer),
  );

const saveConnection = (plane: NonNullable<ServerSettingsPatch["plane"]>) =>
  Effect.gen(function* () {
    const settings = yield* ServerSettingsModule.ServerSettingsService;
    yield* settings.updateSettings({ plane });
  });

const CONFIGURED: NonNullable<ServerSettingsPatch["plane"]> = {
  baseUrl: "https://plane.example.test",
  workspaceSlug: "acme",
  apiToken: "plane-token-value",
};

describe("PlaneService", () => {
  it.layer(NodeServices.layer)("connection", (it) => {
    it.effect("reports an unconfigured connection without any HTTP call", () => {
      const { requests, httpClient } = respond(200, {});
      return Effect.gen(function* () {
        const plane = yield* PlaneService.PlaneService;
        const status = yield* plane.connectionStatus;
        expect(status).toEqual({ configured: false, baseUrl: null, workspaceSlug: null });
        const failure = yield* plane.listProjects({}).pipe(Effect.flip);
        expect(failure._tag).toBe("PlaneNotConfiguredError");
        expect(failure).toMatchObject({ reason: "missing-connection" });
        expect(requests).toEqual([]);
      }).pipe(Effect.provide(layerPlane(httpClient)));
    });

    it.effect("derives the workspace from a full workspace URL", () => {
      const { requests, httpClient } = respond(200, {});
      return Effect.gen(function* () {
        yield* saveConnection({
          baseUrl: "https://plane.example.test/acme/",
          workspaceSlug: "",
          apiToken: "plane-token-value",
        });
        const plane = yield* PlaneService.PlaneService;
        expect(yield* plane.connectionStatus).toEqual({
          configured: true,
          baseUrl: "https://plane.example.test",
          workspaceSlug: "acme",
        });
        expect(requests).toEqual([]);
      }).pipe(Effect.provide(layerPlane(httpClient)));
    });

    it.effect("keeps an explicit slug and strips it from a pasted base path", () => {
      const { httpClient } = respond(200, {});
      return Effect.gen(function* () {
        yield* saveConnection({
          baseUrl: "https://plane.example.test/acme",
          workspaceSlug: "acme",
          apiToken: "plane-token-value",
        });
        const plane = yield* PlaneService.PlaneService;
        expect(yield* plane.connectionStatus).toEqual({
          configured: true,
          baseUrl: "https://plane.example.test",
          workspaceSlug: "acme",
        });
      }).pipe(Effect.provide(layerPlane(httpClient)));
    });

    it.effect("rejects a base URL that is not an http(s) URL", () => {
      const { requests, httpClient } = respond(200, {});
      return Effect.gen(function* () {
        yield* saveConnection({ baseUrl: "not a url", workspaceSlug: "acme", apiToken: "t" });
        const plane = yield* PlaneService.PlaneService;
        const failure = yield* plane.listProjects({}).pipe(Effect.flip);
        expect(failure).toMatchObject({ _tag: "PlaneNotConfiguredError", reason: "invalid-url" });
        expect(requests).toEqual([]);
      }).pipe(Effect.provide(layerPlane(httpClient)));
    });

    it.effect("reports a missing token instead of calling Plane", () => {
      const { requests, httpClient } = respond(200, {});
      return Effect.gen(function* () {
        yield* saveConnection({
          baseUrl: "https://plane.example.test",
          workspaceSlug: "acme",
          apiToken: "",
        });
        const plane = yield* PlaneService.PlaneService;
        const failure = yield* plane.listTasks({ projectId: "proj-1" }).pipe(Effect.flip);
        expect(failure).toMatchObject({ _tag: "PlaneNotConfiguredError", reason: "missing-token" });
        expect(requests).toEqual([]);
      }).pipe(Effect.provide(layerPlane(httpClient)));
    });

    it.effect("requires a workspace it cannot infer instead of calling a slug-less URL", () => {
      const { requests, httpClient } = respond(200, {});
      return Effect.gen(function* () {
        yield* saveConnection({
          baseUrl: "https://plane.example.test",
          workspaceSlug: "",
          apiToken: "plane-token-value",
        });
        const plane = yield* PlaneService.PlaneService;
        const failure = yield* plane.listProjects({}).pipe(Effect.flip);
        expect(failure).toMatchObject({
          _tag: "PlaneNotConfiguredError",
          reason: "missing-workspace",
        });
        expect(requests).toEqual([]);
      }).pipe(Effect.provide(layerPlane(httpClient)));
    });

    it.effect("sends the token as an X-API-Key header and never echoes it in errors", () => {
      const { requests, httpClient } = respond(401, { error: "invalid" });
      return Effect.gen(function* () {
        yield* saveConnection(CONFIGURED);
        const plane = yield* PlaneService.PlaneService;
        const failure = yield* plane.listProjects({}).pipe(Effect.flip);
        expect(failure._tag).toBe("PlaneUnauthorizedError");
        expect(requests).toHaveLength(1);
        expect(requests[0]!.apiKey).toBe("plane-token-value");
        expect(JSON.stringify(failure)).not.toContain("plane-token-value");
        expect(requests[0]!.url).toBe(
          "https://plane.example.test/api/v1/workspaces/acme/projects/?per_page=50",
        );
      }).pipe(Effect.provide(layerPlane(httpClient)));
    });

    it.effect("resolves a secret-provider reference token before calling Plane", () => {
      const { requests, httpClient } = respond(200, { results: [project] });
      return Effect.gen(function* () {
        yield* saveConnection({
          baseUrl: "https://plane.example.test",
          workspaceSlug: "acme",
          apiToken: {
            provider: SecretProviderId.make("personal"),
            reference: "op://Vault/Plane/token",
          },
        });
        const plane = yield* PlaneService.PlaneService;
        yield* plane.listProjects({});
        expect(requests[0]!.apiKey).toBe("resolved-reference-token");
      }).pipe(
        Effect.provide(
          layerPlaneWithSecretResolver(httpClient, (references) =>
            Effect.succeed(references.map(() => "resolved-reference-token")),
          ),
        ),
      );
    });

    it.effect("verifies the token and workspace on test connection", () => {
      const { requests, httpClient } = respondWith([
        { status: 200, body: { id: "user-1", display_name: "Ada", email: "ada@example.test" } },
        { status: 200, body: { results: [project] } },
      ]);
      return Effect.gen(function* () {
        yield* saveConnection(CONFIGURED);
        const plane = yield* PlaneService.PlaneService;
        const result = yield* plane.testConnection({});
        expect(result).toEqual({
          workspaceSlug: "acme",
          userId: "user-1",
          displayName: "Ada",
        });
        expect(requests.map((request) => request.url)).toEqual([
          "https://plane.example.test/api/v1/users/me/",
          "https://plane.example.test/api/v1/workspaces/acme/projects/",
        ]);
        // The workspace probe carries no email or member data either.
        expect(requests.every((request) => !request.url.includes("email"))).toBe(true);
      }).pipe(Effect.provide(layerPlane(httpClient)));
    });

    it.effect(
      "stores the token in the secret store, keeps it across updates, and drops it with the connection",
      () => {
        const { requests, httpClient, respondNext } = scripted();
        return Effect.gen(function* () {
          const settings = yield* ServerSettingsModule.ServerSettingsService;
          const secretStore = yield* ServerSecretStore.ServerSecretStore;
          // The name scheme settingsSecrets uses for Plane credential fields.
          const secretName = `plane-${Buffer.from("apiToken").toString("base64url")}`;

          yield* settings.updateSettings({ plane: CONFIGURED });
          const forClient = ServerSettingsModule.redactServerSettingsForClient(
            yield* settings.getSettings,
          );
          expect(forClient.plane?.apiToken).toBe(SECRET_REDACTED);
          expect(JSON.stringify(forClient)).not.toContain("plane-token-value");

          // Sending the redaction marker back keeps the stored literal working.
          yield* settings.updateSettings({
            plane: {
              baseUrl: "https://plane.example.test",
              workspaceSlug: "globo",
              apiToken: SECRET_REDACTED,
            },
          });
          const plane = yield* PlaneService.PlaneService;
          respondNext({ status: 200, body: { results: [] } });
          yield* plane.listProjects({});
          expect(requests[0]!.apiKey).toBe("plane-token-value");
          expect(requests[0]!.url).toBe(
            "https://plane.example.test/api/v1/workspaces/globo/projects/?per_page=50",
          );

          // Removing the connection clears the stored token too.
          yield* settings.updateSettings({ plane: null });
          expect((yield* settings.getSettings).plane).toBeNull();
          expect(Option.isNone(yield* secretStore.get(secretName))).toBe(true);
        }).pipe(Effect.provide(layerPlane(httpClient)));
      },
    );
  });

  it.layer(NodeServices.layer)("listing and search", (it) => {
    it.effect("decodes the project page and trusts only next_page_results for hasNext", () => {
      const { httpClient } = respondWith([
        {
          status: 200,
          body: {
            results: [project],
            total_results: 30,
            next_cursor: "cursor-2",
            next_page_results: false,
          },
        },
        {
          status: 200,
          body: {
            results: [{ id: "proj-2", name: "Beta" }],
            next_cursor: "cursor-3",
            next_page_results: true,
          },
        },
      ]);
      return Effect.gen(function* () {
        yield* saveConnection(CONFIGURED);
        const plane = yield* PlaneService.PlaneService;
        const page = yield* plane.listProjects({});
        expect(page.projects[0]).toMatchObject({
          id: "proj-1",
          name: "Alpha",
          identifier: "ALPHA",
          url: "https://plane.example.test/acme/projects/proj-1/",
        });
        // A cursor without the boolean is not proof of another page.
        expect(page.page).toEqual({ nextCursor: "cursor-2", hasNext: false, totalResults: 30 });
        const next = yield* plane.listProjects({ cursor: "cursor-2" });
        expect(next.page).toEqual({ nextCursor: "cursor-3", hasNext: true, totalResults: null });
      }).pipe(Effect.provide(layerPlane(httpClient)));
    });

    it.effect(
      "projects browse fields and decodes metadata-only task rows with tolerant defaults",
      () => {
        const { requests, httpClient } = respond(200, {
          results: [
            // The projected payload carries no description_html at all.
            issue({ description_html: undefined }),
            issue({
              id: "task-2",
              sequence_id: "129",
              priority: "someday-new",
              description_html: null,
              state: null,
              assignees: undefined,
              created_at: null,
            }),
          ],
          next_page_results: false,
        });
        return Effect.gen(function* () {
          yield* saveConnection(CONFIGURED);
          const plane = yield* PlaneService.PlaneService;
          const page = yield* plane.listTasks({ projectId: "proj-1" });
          expect(requests[0]!.url).toBe(
            "https://plane.example.test/api/v1/workspaces/acme/projects/proj-1/issues/?per_page=50&fields=id%2Cname%2Cpriority%2Csequence_id%2Cproject%2Cstate%2Cassignees%2Ccreated_at%2Cupdated_at",
          );
          expect(page.tasks[0]).toEqual({
            id: "task-1",
            sequenceId: 128,
            name: "Ship the thing",
            descriptionHtml: "",
            priority: "high",
            projectId: "proj-1",
            stateId: "state-1",
            assigneeIds: ["user-1"],
            createdAt: "2026-10-31T00:00:00Z",
            updatedAt: "2026-10-31T01:00:00Z",
            url: "https://plane.example.test/acme/projects/proj-1/issues/task-1/",
          });
          expect(page.tasks[1]).toMatchObject({
            sequenceId: 129,
            priority: "none",
            descriptionHtml: "",
            stateId: null,
            assigneeIds: [],
          });
        }).pipe(Effect.provide(layerPlane(httpClient)));
      },
    );

    it.effect("fetches the selected task with its full description HTML", () => {
      const { requests, httpClient } = respond(
        200,
        issue({ description_html: "<p>Full body</p>" }),
      );
      return Effect.gen(function* () {
        yield* saveConnection(CONFIGURED);
        const plane = yield* PlaneService.PlaneService;
        const task = yield* plane.getTask({ projectId: "proj-1", taskId: "task-1" });
        expect(task.descriptionHtml).toBe("<p>Full body</p>");
        // The detail request is unprojected: no fields parameter narrows the reply.
        expect(requests[0]!.method).toBe("GET");
        expect(requests[0]!.url).toBe(
          "https://plane.example.test/api/v1/workspaces/acme/projects/proj-1/issues/task-1/",
        );
      }).pipe(Effect.provide(layerPlane(httpClient)));
    });

    it.effect("searches the dedicated endpoint scoped to the project and reports the cap", () => {
      const { requests, httpClient } = respond(200, {
        issues: [
          {
            id: "task-1",
            name: "Ship the thing",
            sequence_id: 128,
            project_id: "proj-1",
            project__identifier: "ALPHA",
          },
        ],
      });
      return Effect.gen(function* () {
        yield* saveConnection(CONFIGURED);
        const plane = yield* PlaneService.PlaneService;
        const result = yield* plane.searchTasks({ projectId: "proj-1", query: "GEN 128" });
        expect(requests[0]!.url).toBe(
          "https://plane.example.test/api/v1/workspaces/acme/issues/search/?search=GEN+128&project_id=proj-1&limit=100",
        );
        expect(result.limit).toBe(100);
        expect(result.truncated).toBe(false);
        expect(result.hits[0]).toMatchObject({
          id: "task-1",
          sequenceId: 128,
          projectIdentifier: "ALPHA",
          url: "https://plane.example.test/acme/projects/proj-1/issues/task-1/",
        });
      }).pipe(Effect.provide(layerPlane(httpClient)));
    });

    it.effect("marks search results that filled the limit as truncated", () => {
      const { httpClient } = respond(200, {
        issues: Array.from({ length: 100 }, (_, index) => ({
          id: `task-${index}`,
          name: `Task ${index}`,
          sequence_id: index + 1,
          project_id: "proj-1",
        })),
      });
      return Effect.gen(function* () {
        yield* saveConnection(CONFIGURED);
        const plane = yield* PlaneService.PlaneService;
        const capped = yield* plane.searchTasks({ projectId: "proj-1", query: "task" });
        expect(capped.truncated).toBe(true);
        expect(capped.hits).toHaveLength(100);
      }).pipe(Effect.provide(layerPlane(httpClient)));
    });

    it.effect("loads comments as their own page", () => {
      const { httpClient } = respond(200, {
        results: [
          {
            id: "comment-1",
            comment_html: "<p>Hi</p>",
            actor: "user-1",
            created_at: "2026-10-31T02:00:00Z",
          },
          { id: "comment-2", comment_html: null, actor: null },
        ],
        next_page_results: false,
      });
      return Effect.gen(function* () {
        yield* saveConnection(CONFIGURED);
        const plane = yield* PlaneService.PlaneService;
        const page = yield* plane.listComments({ projectId: "proj-1", taskId: "task-1" });
        expect(page.comments[0]).toEqual({
          id: "comment-1",
          html: "<p>Hi</p>",
          actorId: "user-1",
          createdAt: "2026-10-31T02:00:00Z",
        });
        expect(page.comments[1]).toEqual({
          id: "comment-2",
          html: "",
          actorId: null,
          createdAt: null,
        });
      }).pipe(Effect.provide(layerPlane(httpClient)));
    });

    it.effect("loads project states and members without member emails", () => {
      const { requests, httpClient } = respondWith([
        {
          status: 200,
          body: { results: [{ id: "state-1", name: "Todo", color: "#ff0000", group: "todo" }] },
        },
        {
          status: 200,
          body: [{ id: "user-1", display_name: "Ada Lovelace", email: "ada@example.test" }],
        },
      ]);
      return Effect.gen(function* () {
        yield* saveConnection(CONFIGURED);
        const plane = yield* PlaneService.PlaneService;
        const metadata = yield* plane.projectMetadata({ projectId: "proj-1" });
        expect(metadata.states).toEqual([
          { id: "state-1", name: "Todo", color: "#ff0000", group: "todo" },
        ]);
        expect(metadata.members).toEqual([
          { id: "user-1", displayName: "Ada Lovelace", avatarUrl: null },
        ]);
        expect(requests.some((request) => request.url.includes("/members/"))).toBe(true);
        expect(requests.every((request) => !request.url.includes("email"))).toBe(true);
      }).pipe(Effect.provide(layerPlane(httpClient)));
    });
  });

  it.layer(NodeServices.layer)("writes", (it) => {
    it.effect("creates a task with only the provided fields", () => {
      const { requests, httpClient } = respond(200, issue());
      return Effect.gen(function* () {
        yield* saveConnection(CONFIGURED);
        const plane = yield* PlaneService.PlaneService;
        const task = yield* plane.createTask({
          projectId: "proj-1",
          name: "Ship the thing",
          descriptionHtml: "<p>Body</p>",
        });
        expect(task.id).toBe("task-1");
        expect(requests[0]!.method).toBe("POST");
        expect(requests[0]!.url).toBe(
          "https://plane.example.test/api/v1/workspaces/acme/projects/proj-1/issues/",
        );
        expect(JSON.parse(requests[0]!.body)).toEqual({
          name: "Ship the thing",
          description_html: "<p>Body</p>",
        });
      }).pipe(Effect.provide(layerPlane(httpClient)));
    });

    it.effect("patches only the edited fields and leaves the rest to Plane", () => {
      const { requests, httpClient } = respond(200, issue({ priority: "urgent" }));
      return Effect.gen(function* () {
        yield* saveConnection(CONFIGURED);
        const plane = yield* PlaneService.PlaneService;
        yield* plane.updateTask({ projectId: "proj-1", taskId: "task-1", priority: "urgent" });
        expect(requests[0]!.method).toBe("PATCH");
        expect(requests[0]!.url).toBe(
          "https://plane.example.test/api/v1/workspaces/acme/projects/proj-1/issues/task-1/",
        );
        expect(JSON.parse(requests[0]!.body)).toEqual({ priority: "urgent" });
      }).pipe(Effect.provide(layerPlane(httpClient)));
    });

    it.effect("posts a comment as comment_html", () => {
      const { requests, httpClient } = respond(200, {
        id: "comment-1",
        comment_html: "<p>Looks good</p>",
        actor: "user-1",
      });
      return Effect.gen(function* () {
        yield* saveConnection(CONFIGURED);
        const plane = yield* PlaneService.PlaneService;
        const comment = yield* plane.addComment({
          projectId: "proj-1",
          taskId: "task-1",
          html: "<p>Looks good</p>",
        });
        expect(comment.id).toBe("comment-1");
        expect(requests[0]!.method).toBe("POST");
        expect(JSON.parse(requests[0]!.body)).toEqual({ comment_html: "<p>Looks good</p>" });
      }).pipe(Effect.provide(layerPlane(httpClient)));
    });

    it.effect("fails a rejected write once without retrying", () => {
      const { requests, httpClient } = respond(500, { error: "boom" });
      return Effect.gen(function* () {
        yield* saveConnection(CONFIGURED);
        const plane = yield* PlaneService.PlaneService;
        const failure = yield* plane
          .createTask({ projectId: "proj-1", name: "New note" })
          .pipe(Effect.flip);
        expect(failure._tag).toBe("PlaneUnavailableError");
        expect(requests).toHaveLength(1);
      }).pipe(Effect.provide(layerPlane(httpClient)));
    });

    it.effect("maps error statuses and 429 retry hints to typed errors", () => {
      const { httpClient, respondNext } = scripted();
      return Effect.gen(function* () {
        yield* saveConnection(CONFIGURED);
        const plane = yield* PlaneService.PlaneService;

        respondNext({ status: 401, body: {} });
        const unauthorized = yield* Effect.flip(plane.listProjects({}));
        expect(unauthorized._tag).toBe("PlaneUnauthorizedError");

        respondNext({ status: 404, body: {} });
        const taskNotFound = yield* Effect.flip(
          plane.getTask({ projectId: "proj-1", taskId: "missing" }),
        );
        expect(taskNotFound._tag).toBe("PlaneNotFoundError");
        expect(taskNotFound).toMatchObject({ resource: "task" });

        respondNext({ status: 404, body: {} });
        const projectNotFound = yield* Effect.flip(plane.listTasks({ projectId: "missing" }));
        expect(projectNotFound).toMatchObject({ _tag: "PlaneNotFoundError", resource: "project" });

        respondNext({ status: 404, body: {} });
        const workspaceNotFound = yield* Effect.flip(plane.listProjects({}));
        expect(workspaceNotFound).toMatchObject({
          _tag: "PlaneNotFoundError",
          resource: "workspace",
        });

        respondNext({ status: 400, body: {} });
        const rejected = yield* Effect.flip(
          plane.updateTask({ projectId: "proj-1", taskId: "task-1", name: "x" }),
        );
        expect(rejected._tag).toBe("PlaneValidationError");
        expect(rejected).toMatchObject({ status: 400 });

        respondNext({ status: 502, body: {} });
        const badResponse = yield* Effect.flip(plane.listProjects({}));
        expect(badResponse._tag).toBe("PlaneUnavailableError");
        expect(badResponse).toMatchObject({ reason: "bad-response" });

        respondNext({ status: 429, body: {}, headers: { "retry-after": "7" } });
        const limited = yield* Effect.flip(plane.listProjects({}));
        expect(limited._tag).toBe("PlaneRateLimitedError");
        expect(limited).toMatchObject({ retryAfterSeconds: 7 });

        respondNext({ status: 429, body: {} });
        const unbounded = yield* Effect.flip(plane.listProjects({}));
        expect(unbounded).toMatchObject({ _tag: "PlaneRateLimitedError", retryAfterSeconds: null });
      }).pipe(Effect.provide(layerPlane(httpClient)));
    });

    it.effect("fails unreadable upstream payloads with a validation error", () => {
      const { httpClient, respondNext } = scripted();
      return Effect.gen(function* () {
        yield* saveConnection(CONFIGURED);
        const plane = yield* PlaneService.PlaneService;

        respondNext({ status: 200, body: { results: [{ id: "only-id" }] } });
        const itemFailure = yield* plane.listProjects({}).pipe(Effect.flip);
        expect(itemFailure._tag).toBe("PlaneValidationError");
        expect(itemFailure).toMatchObject({ status: null });

        // A list response without `results` is malformed, not an empty page.
        respondNext({ status: 200, body: {} });
        const envelopeFailure = yield* plane.listTasks({ projectId: "proj-1" }).pipe(Effect.flip);
        expect(envelopeFailure._tag).toBe("PlaneValidationError");
        expect(envelopeFailure).toMatchObject({ status: null });
      }).pipe(Effect.provide(layerPlane(httpClient)));
    });

    it.effect("fails an over-limit response without reading it into an error", () => {
      const oversized = "x".repeat(Number(ByteSize.megabytes(8)) + 1);
      const { httpClient } = respond(200, oversized);
      return Effect.gen(function* () {
        yield* saveConnection(CONFIGURED);
        const plane = yield* PlaneService.PlaneService;
        const failure = yield* plane.listProjects({}).pipe(Effect.flip);
        expect(failure._tag).toBe("PlaneValidationError");
        expect(JSON.stringify(failure)).not.toContain("xxxxx");
      }).pipe(Effect.provide(layerPlane(httpClient)));
    });

    it.effect("maps transport failures to unavailable", () => {
      const { httpClient } = failNetwork();
      return Effect.gen(function* () {
        yield* saveConnection(CONFIGURED);
        const plane = yield* PlaneService.PlaneService;
        const network = yield* plane.listProjects({}).pipe(Effect.flip);
        expect(network._tag).toBe("PlaneUnavailableError");
        expect(network).toMatchObject({ reason: "network" });
      }).pipe(Effect.provide(layerPlane(httpClient)));
    });

    it.effect("times out a hung read", () => {
      const { httpClient } = hang();
      return Effect.gen(function* () {
        yield* saveConnection(CONFIGURED);
        const plane = yield* PlaneService.PlaneService;
        const fiber = yield* Effect.forkChild(plane.listProjects({}).pipe(Effect.flip));
        yield* TestClock.adjust("16 seconds");
        const exit = yield* Fiber.await(fiber);
        // The flipped effect succeeds with the mapped error once the request times out.
        if (!Exit.isSuccess(exit)) return assert.fail("expected the request to time out");
        const timeout = exit.value;
        expect(timeout._tag).toBe("PlaneUnavailableError");
        expect(timeout).toMatchObject({ reason: "timeout" });
      }).pipe(Effect.provide(layerPlane(httpClient)));
    });
  });
});
