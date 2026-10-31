import { AuthSettingsWriteScope, type EnvironmentId, type PlaneSettings } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";

import { isElectron } from "~/env";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { planeEnvironment } from "~/state/plane";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ITEM_ROW_CLASSNAME } from "./itemRows";
import {
  planeConnectionErrorMessage,
  planeConnectionPatch,
  planeTokenIsConfigured,
  resolvePlaneTargetEnvironmentId,
  type PlaneConnectionDraft,
} from "./PlaneConnectionSettings.logic";
import { SecretInput } from "./SecretInput";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsPageContainer, SettingsSection, SettingsUnavailableGroup } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export function PlaneConnectionSettingsPanel() {
  return (
    <SettingsPageContainer>
      {isElectron ? <PlaneConnectionSettings /> : <PlaneDesktopOnlyNotice />}
    </SettingsPageContainer>
  );
}

function PlaneDesktopOnlyNotice() {
  return (
    <SettingsSection id={searchableSetting("plane").id} title="Plane">
      <SettingsUnavailableGroup message="Only available in the desktop app.">
        <p className={cn(ITEM_ROW_CLASSNAME, "text-xs text-muted-foreground")}>
          Open T3 Code on your desktop to connect a Plane instance.
        </p>
      </SettingsUnavailableGroup>
    </SettingsSection>
  );
}

function PlaneConnectionSettings() {
  const { scope, connectedEnvironments } = useSettingsScope();
  const environmentId = resolvePlaneTargetEnvironmentId(
    scope.environmentIds,
    connectedEnvironments.map((environment) => environment.environmentId),
  );
  if (environmentId === null) {
    return (
      <SettingsSection id={searchableSetting("plane").id} title="Plane">
        <p className={cn(ITEM_ROW_CLASSNAME, "text-sm text-muted-foreground")}>
          {connectedEnvironments.length === 0
            ? "Connect a server to configure its Plane connection."
            : "Select a server to configure its Plane connection."}
        </p>
      </SettingsSection>
    );
  }
  return <PlaneConnectionSection environmentId={environmentId} />;
}

function PlaneConnectionSection({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const saved = useEnvironmentSettings(environmentId, (settings) => settings.plane);
  const tokenConfigured = planeTokenIsConfigured(saved?.apiToken);
  // Keying on the saved connection reseeds the drafts when the server's settings change.
  return (
    <SettingsSection id={searchableSetting("plane").id} title="Plane">
      <PlaneConnectionFields
        key={`${environmentId}:${saved?.baseUrl ?? ""}:${saved?.workspaceSlug ?? ""}:${tokenConfigured ? "1" : "0"}`}
        environmentId={environmentId}
        saved={saved}
      />
    </SettingsSection>
  );
}

function PlaneConnectionFields({
  environmentId,
  saved,
}: {
  readonly environmentId: EnvironmentId;
  readonly saved: PlaneSettings | null;
}) {
  const canWriteSettings = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "save Plane connection",
    reportFailure: false,
  });
  const status = useEnvironmentQuery(
    planeEnvironment.connectionStatus({ environmentId, input: {} }),
  );
  // The test only asks Plane once the user asks for it, so opening the page stays quiet.
  const [testRequested, setTestRequested] = useState(false);
  const test = useEnvironmentQuery(
    testRequested ? planeEnvironment.testConnection({ environmentId, input: {} }) : null,
  );
  const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? "");
  const [workspaceSlug, setWorkspaceSlug] = useState(saved?.workspaceSlug ?? "");
  const [apiToken, setApiToken] = useState("");
  const [pending, setPending] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tokenConfigured = planeTokenIsConfigured(saved?.apiToken);
  const configured = status.data?.configured ?? saved !== null;
  const workspace = status.data?.workspaceSlug ?? saved?.workspaceSlug ?? "";
  const testError = test.failure ?? test.error;
  const testSummary = test.data
    ? `Connected to ${test.data.workspaceSlug}${test.data.displayName ? ` as ${test.data.displayName}` : ""}.`
    : null;

  const save = async () => {
    setPending("save");
    setError(null);
    const draft: PlaneConnectionDraft = { baseUrl, workspaceSlug, apiToken };
    const result = await updateSettings({
      environmentId,
      input: {
        patch: planeConnectionPatch(saved, draft),
      },
    });
    setPending(null);
    if (result._tag === "Success") {
      setApiToken("");
      setTestRequested(false);
      return;
    }
    setError(planeConnectionErrorMessage(squashAtomCommandFailure(result)));
  };

  const remove = async () => {
    setPending("remove");
    setError(null);
    const result = await updateSettings({
      environmentId,
      input: { patch: { plane: null } },
    });
    setPending(null);
    if (result._tag === "Success") {
      setBaseUrl("");
      setWorkspaceSlug("");
      setApiToken("");
      setTestRequested(false);
      return;
    }
    setError(planeConnectionErrorMessage(squashAtomCommandFailure(result)));
  };

  const busy = pending !== null || test.isPending;

  return (
    <form
      className={cn(ITEM_ROW_CLASSNAME, "grid gap-4")}
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || !canWriteSettings) return;
        void save();
      }}
    >
      {/* Locked while a request is in flight: a save clears the token draft, which would drop edits made mid-request. */}
      <fieldset disabled={busy} className="contents">
        <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
          T3 Code reaches Plane through this server, so the machine running it must reach the
          instance over your local network or Tailscale. The API token is kept in the server&apos;s
          secret store and is never shown again.
        </p>
        <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
          <div className="grid gap-1.5">
            <Label htmlFor={`plane-url-${environmentId}`}>Plane URL</Label>
            <Input
              id={`plane-url-${environmentId}`}
              size="sm"
              autoComplete="off"
              inputMode="url"
              spellCheck={false}
              placeholder="https://plane.example.com"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`plane-workspace-${environmentId}`}>Workspace</Label>
            <Input
              id={`plane-workspace-${environmentId}`}
              size="sm"
              autoComplete="off"
              spellCheck={false}
              placeholder="Taken from the link"
              value={workspaceSlug}
              onChange={(event) => setWorkspaceSlug(event.target.value)}
            />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`plane-token-${environmentId}`}>API token</Label>
          <SecretInput
            id={`plane-token-${environmentId}`}
            size="sm"
            configured={tokenConfigured}
            value={apiToken}
            onChange={(event) => setApiToken(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Create a personal API token in Plane and paste it here. Leave it empty to keep the token
            already saved on this server.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {configured
              ? workspace
                ? `Saved on this server. Workspace: ${workspace}.`
                : "Saved on this server."
              : "No Plane connection on this server yet."}
          </p>
          <div className="flex shrink-0 gap-2">
            {configured ? (
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={busy || !canWriteSettings}
                onClick={() => void remove()}
              >
                Remove
              </Button>
            ) : null}
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={busy || !configured}
              onClick={() => {
                setTestRequested(true);
                test.refresh();
              }}
            >
              {test.isPending ? "Testing…" : "Test connection"}
            </Button>
            <Button
              type="submit"
              size="xs"
              disabled={busy || !canWriteSettings || baseUrl.trim().length === 0}
            >
              Save
            </Button>
          </div>
        </div>
        {canWriteSettings ? null : (
          <p className="text-xs text-muted-foreground">
            This connection cannot change settings on this server.
          </p>
        )}
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        {testError ? (
          <p role="alert" className="text-xs text-destructive">
            {planeConnectionErrorMessage(testError)}
          </p>
        ) : null}
        {testSummary ? (
          <p role="status" className="text-xs text-muted-foreground">
            {testSummary}
          </p>
        ) : null}
      </fieldset>
    </form>
  );
}
