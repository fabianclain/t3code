import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, SecretProviderId } from "@t3tools/contracts";

import {
  planeConnectionErrorMessage,
  planeConnectionPatch,
  planeTokenIsConfigured,
  resolvePlaneTargetEnvironmentId,
} from "./PlaneConnectionSettings.logic";

const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");

describe("resolvePlaneTargetEnvironmentId", () => {
  it("edits the one connected environment in scope", () => {
    expect(resolvePlaneTargetEnvironmentId([local], [local, remote])).toBe(local);
  });

  it("leaves an offline environment unedited instead of falling back", () => {
    expect(resolvePlaneTargetEnvironmentId([local], [remote])).toBeNull();
  });

  it("stays ambiguous while several connected environments are in scope", () => {
    expect(resolvePlaneTargetEnvironmentId([local, remote], [local, remote])).toBeNull();
  });
});

describe("planeConnectionPatch", () => {
  it("keeps the stored token when the token field is left empty", () => {
    const saved = {
      baseUrl: "https://plane.example.com",
      workspaceSlug: "team",
      apiToken: "••••••",
    };
    expect(
      planeConnectionPatch(saved, {
        baseUrl: "https://plane.example.com/team",
        workspaceSlug: "",
        apiToken: "",
      }).plane,
    ).toEqual({
      baseUrl: "https://plane.example.com/team",
      workspaceSlug: "",
      apiToken: "••••••",
    });
  });

  it("replaces the stored token with a typed one", () => {
    const saved = { baseUrl: "https://plane.example.com", workspaceSlug: "", apiToken: "••••••" };
    expect(
      planeConnectionPatch(saved, {
        baseUrl: "https://plane.example.com",
        workspaceSlug: "",
        apiToken: "  new-token  ",
      }).plane,
    ).toEqual({
      baseUrl: "https://plane.example.com",
      workspaceSlug: "",
      apiToken: "new-token",
    });
  });

  it("stores an empty token when nothing was saved before", () => {
    expect(
      planeConnectionPatch(null, {
        baseUrl: " https://plane.example.com ",
        workspaceSlug: " team ",
        apiToken: "",
      }).plane,
    ).toEqual({
      baseUrl: "https://plane.example.com",
      workspaceSlug: "team",
      apiToken: "",
    });
  });
});

describe("planeTokenIsConfigured", () => {
  it("counts a redaction marker and a secret reference as configured", () => {
    expect(planeTokenIsConfigured("••••••")).toBe(true);
    expect(
      planeTokenIsConfigured({
        provider: SecretProviderId.make("vault"),
        reference: "plane/token",
      }),
    ).toBe(true);
    expect(planeTokenIsConfigured("")).toBe(false);
    expect(planeTokenIsConfigured(undefined)).toBe(false);
  });
});

describe("planeConnectionErrorMessage", () => {
  it("names the next step when the failure carries no message", () => {
    expect(planeConnectionErrorMessage(new Error("   "))).toContain("Could not reach Plane");
    expect(planeConnectionErrorMessage(undefined)).toContain("Could not reach Plane");
    expect(planeConnectionErrorMessage(42)).toContain("Could not reach Plane");
  });

  it("keeps a message that arrived as text", () => {
    expect(planeConnectionErrorMessage("Plane could not be reached.")).toBe(
      "Plane could not be reached.",
    );
  });

  it("keeps the server's own message and bounds its length", () => {
    expect(planeConnectionErrorMessage(new Error("Plane rejected the API token."))).toBe(
      "Plane rejected the API token.",
    );
    expect(planeConnectionErrorMessage(new Error("x".repeat(500)))).toHaveLength(201);
  });
});
