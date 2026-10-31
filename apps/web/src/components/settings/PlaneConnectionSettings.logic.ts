import type { EnvironmentId, PlaneSettings, ServerSettingsPatch } from "@t3tools/contracts";

export interface PlaneConnectionDraft {
  readonly baseUrl: string;
  readonly workspaceSlug: string;
  readonly apiToken: string;
}

/**
 * The one environment whose Plane connection this page edits. Several connected
 * environments in scope stay ambiguous: the page asks for one instead of editing
 * every environment's connection.
 */
export function resolvePlaneTargetEnvironmentId(
  scopeEnvironmentIds: readonly EnvironmentId[],
  connectedEnvironmentIds: readonly EnvironmentId[],
): EnvironmentId | null {
  const connected = scopeEnvironmentIds.filter((environmentId) =>
    connectedEnvironmentIds.includes(environmentId),
  );
  return connected.length === 1 ? (connected[0] ?? null) : null;
}

/** A stored token reaches the client as a redaction marker, or as a secret reference. */
export function planeTokenIsConfigured(apiToken: PlaneSettings["apiToken"] | undefined): boolean {
  if (apiToken === undefined) return false;
  return typeof apiToken === "string" ? apiToken.length > 0 : true;
}

/**
 * The patch that saves the draft. A blank token keeps the stored one: the client
 * only ever holds the redaction marker, so the marker goes back unchanged and the
 * server keeps the secret it holds.
 */
export function planeConnectionPatch(
  saved: PlaneSettings | null,
  draft: PlaneConnectionDraft,
): ServerSettingsPatch {
  const token = draft.apiToken.trim();
  return {
    plane: {
      baseUrl: draft.baseUrl.trim(),
      workspaceSlug: draft.workspaceSlug.trim(),
      apiToken: token.length > 0 ? token : (saved?.apiToken ?? ""),
    },
  };
}

/** A bounded message the user can act on; Plane's own words when it sent any. */
export function planeConnectionErrorMessage(error: unknown): string {
  const message =
    error instanceof Error ? error.message.trim() : typeof error === "string" ? error.trim() : "";
  if (message.length === 0) {
    return "Could not reach Plane. Check the URL, the token, and that the server can reach the instance.";
  }
  return message.length > 200 ? `${message.slice(0, 200)}…` : message;
}
