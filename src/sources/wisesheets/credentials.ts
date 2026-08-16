import { join } from "node:path";
import { LockedJsonFile } from "../../data/locked-json";

const CREDENTIAL_FILE_VERSION = 1;

interface WisesheetsCredentialFile {
  version: typeof CREDENTIAL_FILE_VERSION;
  apiKey?: string;
}

function validateCredentialFile(value: unknown): WisesheetsCredentialFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The Wisesheets credential file is not an object.");
  }
  const candidate = value as { version?: unknown; apiKey?: unknown };
  if (candidate.version !== CREDENTIAL_FILE_VERSION) {
    throw new Error(`Unsupported Wisesheets credential file version: ${String(candidate.version)}`);
  }
  if (candidate.apiKey !== undefined && typeof candidate.apiKey !== "string") {
    throw new Error("The Wisesheets credential file apiKey must be a string.");
  }
  return {
    version: CREDENTIAL_FILE_VERSION,
    apiKey: candidate.apiKey,
  };
}

function createCredentialFile(): WisesheetsCredentialFile {
  return { version: CREDENTIAL_FILE_VERSION };
}

export function resolveWisesheetsCredentialPath(dataDir: string): string {
  return join(dataDir, "wisesheets", "credentials.json");
}

export function maskApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 8) return "****";
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

/** Persistent Wisesheets API key store. Secrets never enter AppConfig. */
export class WisesheetsCredentialStore {
  readonly path: string;
  private readonly file: LockedJsonFile<WisesheetsCredentialFile>;

  constructor(dataDir: string) {
    this.path = resolveWisesheetsCredentialPath(dataDir);
    this.file = new LockedJsonFile(this.path, {
      create: createCredentialFile,
      validate: validateCredentialFile,
    });
  }

  getEnvApiKey(): string | undefined {
    const envKey = process.env.WISESHEETS_API_KEY?.trim();
    return envKey || undefined;
  }

  async readStoredApiKey(): Promise<string | undefined> {
    const file = await this.file.read();
    const stored = file.apiKey?.trim();
    return stored || undefined;
  }

  async resolveApiKey(): Promise<string | undefined> {
    const envKey = this.getEnvApiKey();
    if (envKey) return envKey;
    return await this.readStoredApiKey();
  }

  async hasApiKey(): Promise<boolean> {
    return !!(await this.resolveApiKey());
  }

  async setApiKey(apiKey: string): Promise<void> {
    const trimmed = apiKey.trim();
    if (!trimmed) throw new Error("API key cannot be empty.");
    await this.file.update((file) => {
      file.apiKey = trimmed;
    });
  }

  async clearApiKey(): Promise<void> {
    await this.file.update((file) => {
      delete file.apiKey;
    });
  }

  async getStatus(): Promise<{ configured: boolean; source: "env" | "file" | "none"; masked?: string }> {
    const envKey = process.env.WISESHEETS_API_KEY?.trim();
    if (envKey) {
      return { configured: true, source: "env", masked: maskApiKey(envKey) };
    }
    const stored = await this.readStoredApiKey();
    if (stored) {
      return { configured: true, source: "file", masked: maskApiKey(stored) };
    }
    return { configured: false, source: "none" };
  }
}
