import type { CliCommandContext, GloomPlugin, GloomPluginContext } from "../../../types/plugin";
import { withConfigData } from "../../../cli/scoped-context";
import { assetDataProvider } from "../../../capabilities";
import { WisesheetsProvider } from "../../../sources/wisesheets";
import { WisesheetsCredentialStore } from "../../../sources/wisesheets/credentials";

function registerWisesheetsKeyCommands(ctx: GloomPluginContext, store: WisesheetsCredentialStore): void {
  ctx.registerCommand({
    id: "wisesheets-key-set",
    label: "Set Wisesheets API Key",
    description: "Save your Wisesheets API key locally",
    keywords: ["wisesheets", "api", "key", "set"],
    category: "config",
    wizardLayout: "form",
    wizard: [
      { key: "apiKey", label: "API Key", type: "password", placeholder: "Your Wisesheets API key" },
      { key: "_validate", label: "Saving...", type: "info", body: ["Saving Wisesheets API key..."] },
    ],
    execute: async (values) => {
      const apiKey = values?.apiKey?.trim();
      if (!apiKey) throw new Error("API key is required");
      await store.setApiKey(apiKey);
      ctx.notify({ body: "Wisesheets API key saved.", type: "success" });
    },
  });

  ctx.registerCommand({
    id: "wisesheets-key-clear",
    label: "Clear Wisesheets API Key",
    description: "Remove the stored Wisesheets API key",
    keywords: ["wisesheets", "api", "key", "clear", "remove"],
    category: "config",
    execute: async () => {
      await store.clearApiKey();
      ctx.notify({ body: "Wisesheets API key cleared.", type: "info" });
    },
  });
}

async function runKeyStatus(store: WisesheetsCredentialStore, ctx: CliCommandContext): Promise<void> {
  const status = await store.getStatus();
  if (ctx.cliOptions.format !== "text") {
    ctx.printResult({ data: status });
    return;
  }
  if (!status.configured) {
    console.log(ctx.output.cliStyles.muted("Wisesheets API key is not configured."));
    return;
  }
  console.log(ctx.output.renderStat("Source", status.source));
  if (status.masked) console.log(ctx.output.renderStat("Key", status.masked));
}

async function runKeySet(apiKey: string, store: WisesheetsCredentialStore, ctx: CliCommandContext): Promise<void> {
  if (!apiKey) ctx.fail("Usage: gloomberb wisesheets key set <api-key>");
  await store.setApiKey(apiKey);
  const status = await store.getStatus();
  if (ctx.cliOptions.format !== "text") {
    ctx.printResult({ data: { saved: true, masked: status.masked, source: status.source } });
    return;
  }
  console.log(ctx.output.cliStyles.success("Wisesheets API key saved."));
  if (status.masked) console.log(ctx.output.renderStat("Key", status.masked));
}

async function runKeyClear(store: WisesheetsCredentialStore, ctx: CliCommandContext): Promise<void> {
  await store.clearApiKey();
  if (ctx.cliOptions.format !== "text") {
    ctx.printResult({ data: { cleared: true } });
    return;
  }
  console.log(ctx.output.cliStyles.success("Wisesheets API key cleared."));
}

async function runWisesheetsKeyCommand(args: string[], ctx: CliCommandContext): Promise<void> {
  await withConfigData(ctx, async ({ dataDir }) => {
    const store = new WisesheetsCredentialStore(dataDir);
    if (args[0] !== "key") {
      ctx.fail("Usage: gloomberb wisesheets key set|status|clear");
    }
    const action = args[1];
    if (action === "status") {
      await runKeyStatus(store, ctx);
      return;
    }
    if (action === "set") {
      await runKeySet(args[2] ?? "", store, ctx);
      return;
    }
    if (action === "clear") {
      await runKeyClear(store, ctx);
      return;
    }
    ctx.fail("Usage: gloomberb wisesheets key set|status|clear");
  });
}

export const wisesheetsPlugin: GloomPlugin = {
  id: "wisesheets",
  name: "Wisesheets",
  version: "1.0.0",
  description: "US financial statement enrichment from your Wisesheets subscription.",
  toggleable: true,
  cli: {
    commands: [{
      name: "wisesheets",
      summary: "Manage Wisesheets API credentials",
      inputShape: "wisesheets key set|status|clear",
      outputShape: "status: { configured, source, masked? }",
      formats: ["text", "json"],
      sideEffectLevel: "local-write",
      examples: [
        "gloomberb wisesheets key status",
        "gloomberb wisesheets key set <api-key>",
        "gloomberb wisesheets key clear",
      ],
      execute: runWisesheetsKeyCommand,
    }],
  },
  setup(ctx) {
    const store = new WisesheetsCredentialStore(ctx.getConfig().dataDir);
    const provider = new WisesheetsProvider(store);
    ctx.registerCapability(assetDataProvider(provider));
    registerWisesheetsKeyCommands(ctx, store);
  },
};
