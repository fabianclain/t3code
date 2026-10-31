import { createFileRoute } from "@tanstack/react-router";

import { PlaneConnectionSettingsPanel } from "../components/settings/PlaneConnectionSettings";

export const Route = createFileRoute("/_chat/settings/plane")({
  component: PlaneConnectionSettingsPanel,
});
