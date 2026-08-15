import type { GloomPlugin } from "../../types/plugin";
import { schwabBroker } from "./broker-adapter";
import { attachSchwabPersistence, resetSchwabPersistence } from "./token-store";

export const schwabPlugin: GloomPlugin = {
  id: "schwab",
  name: "Charles Schwab",
  version: "1.0.0",
  description: "Charles Schwab account sync and portfolio tracking.",
  toggleable: true,
  broker: schwabBroker,

  setup(ctx) {
    attachSchwabPersistence(ctx.persistence);
  },

  dispose() {
    resetSchwabPersistence();
  },
};
