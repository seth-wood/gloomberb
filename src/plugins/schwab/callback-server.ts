import { timingSafeEqual } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SchwabAuthError } from "./types";

export const DEFAULT_SCHWAB_CALLBACK_PORT = 8182;
export const SCHWAB_CALLBACK_TIMEOUT_MS = 5 * 60_000;
export const SCHWAB_CALLBACK_IN_USE_MESSAGE =
  "Schwab sign-in is already in progress on this callback URL. Finish that attempt first.";

const activeCallbackPorts = new Set<string>();

function callbackPortKey(hostname: string, port: number): string {
  return `${hostname}:${port}`;
}

function wrapCallbackListenError(callbackUrl: string, error: unknown): SchwabAuthError {
  if (error instanceof SchwabAuthError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
  if (code === "EADDRINUSE" || /EADDRINUSE|address already in use/i.test(message)) {
    return new SchwabAuthError(
      `Could not listen on ${callbackUrl}. That port is already in use.`,
      "AUTH_REQUIRED",
    );
  }
  return new SchwabAuthError(
    message || `Could not listen on ${callbackUrl}.`,
    "AUTH_REQUIRED",
  );
}

const SUCCESS_HTML = `<!doctype html>
<meta charset="utf-8">
<title>Schwab connected</title>
<body style="font-family: system-ui, sans-serif; padding: 2rem;">
  <p>Gloomberb is connected to Schwab. You can close this window.</p>
</body>`;

export interface SchwabCallbackListenTarget {
  hostname: string;
  port: number;
  protocol: "http" | "https";
}

export interface SchwabCallbackListener {
  url: string;
  code: Promise<string>;
  stop: () => Promise<void>;
}

let cachedTls: { cert: string; key: string } | null = null;

export function parseSchwabCallbackListenTarget(callbackUrl: string): SchwabCallbackListenTarget {
  let url: URL;
  try {
    url = new URL(callbackUrl);
  } catch {
    throw new SchwabAuthError("Schwab callback URL is not valid.", "INVALID_REDIRECT");
  }

  if (url.hostname !== "127.0.0.1") {
    throw new SchwabAuthError("Schwab callback URL must use 127.0.0.1.", "INVALID_REDIRECT");
  }

  const protocol = url.protocol === "http:" ? "http" : url.protocol === "https:" ? "https" : null;
  if (!protocol) {
    throw new SchwabAuthError("Schwab callback URL must be http or https.", "INVALID_REDIRECT");
  }

  const port = url.port ? Number(url.port) : protocol === "https" ? 443 : 80;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new SchwabAuthError("Schwab callback URL has an invalid port.", "INVALID_REDIRECT");
  }
  if (port === 443 || port === 80) {
    throw new SchwabAuthError(
      "Use a high port in the Schwab callback URL, such as https://127.0.0.1:8182. Ports 80/443 require admin privileges.",
      "INVALID_REDIRECT",
    );
  }

  return { hostname: url.hostname, port, protocol };
}

async function generateLocalhostTls(): Promise<{ cert: string; key: string }> {
  if (cachedTls) return cachedTls;

  const dir = await mkdtemp(join(tmpdir(), "gloomberb-schwab-tls-"));
  const keyPath = join(dir, "key.pem");
  const certPath = join(dir, "cert.pem");
  const configPath = join(dir, "openssl.cnf");
  await writeFile(configPath, [
    "[req]",
    "distinguished_name = dn",
    "x509_extensions = ext",
    "prompt = no",
    "[dn]",
    "CN = 127.0.0.1",
    "[ext]",
    "subjectAltName = IP:127.0.0.1",
    "basicConstraints = CA:FALSE",
    "keyUsage = digitalSignature, keyEncipherment",
    "extendedKeyUsage = serverAuth",
    "",
  ].join("\n"));

  try {
    const processRef = Bun.spawn([
      "openssl",
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "3650",
      "-nodes",
      "-config",
      configPath,
    ], { stdout: "ignore", stderr: "pipe" });
    const exitCode = await processRef.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(processRef.stderr).text().catch(() => "");
      throw new Error(stderr.trim() || `openssl exited with ${exitCode}`);
    }
    cachedTls = {
      cert: await readFile(certPath, "utf8"),
      key: await readFile(keyPath, "utf8"),
    };
    return cachedTls;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function openSchwabAuthorizationUrl(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Schwab authorization returned an unsupported URL.");
  }
  const command = process.platform === "darwin"
    ? ["open", parsed.toString()]
    : process.platform === "win32"
      ? ["cmd", "/c", "start", "", parsed.toString()]
      : ["xdg-open", parsed.toString()];
  const processRef = Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
  const exitCode = await processRef.exited;
  if (exitCode !== 0) throw new Error("Could not open the Schwab sign-in page.");
}

function oauthStatesEqual(expected: string, actual: string | null): boolean {
  if (actual == null) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function stateFromAuthUrl(authUrl: string): string | undefined {
  try {
    return new URL(authUrl).searchParams.get("state") ?? undefined;
  } catch {
    return undefined;
  }
}

export async function listenForSchwabCallback(options: {
  callbackUrl: string;
  allowHttp?: boolean;
  expectedState?: string;
}): Promise<SchwabCallbackListener> {
  const target = parseSchwabCallbackListenTarget(options.callbackUrl);
  if (target.protocol === "http" && !options.allowHttp) {
    throw new SchwabAuthError("Schwab callback URL must use https://127.0.0.1.", "INVALID_REDIRECT");
  }

  const tls = target.protocol === "https" ? await generateLocalhostTls() : undefined;
  const requestedKey = callbackPortKey(target.hostname, target.port);
  const lockRequestedPort = target.port !== 0;
  if (lockRequestedPort && activeCallbackPorts.has(requestedKey)) {
    throw new SchwabAuthError(SCHWAB_CALLBACK_IN_USE_MESSAGE, "AUTH_REQUIRED");
  }

  let resolveCode: (code: string) => void = () => {};
  let rejectCode: (error: Error) => void = () => {};
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  if (lockRequestedPort) activeCallbackPorts.add(requestedKey);

  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      hostname: target.hostname,
      port: target.port,
      tls,
      fetch(request) {
        const requestUrl = new URL(request.url);
        const error = requestUrl.searchParams.get("error");
        const nextCode = requestUrl.searchParams.get("code");
        const stateOk = !options.expectedState
          || oauthStatesEqual(options.expectedState, requestUrl.searchParams.get("state"));
        if (error) {
          if (!stateOk) {
            return new Response("Schwab authorization state mismatch.", {
              status: 400,
              headers: { "content-type": "text/plain; charset=utf-8" },
            });
          }
          const description = requestUrl.searchParams.get("error_description") || error;
          rejectCode(new SchwabAuthError(description, "EXCHANGE_FAILED"));
          return new Response(`Schwab authorization failed: ${description}`, {
            status: 400,
            headers: { "content-type": "text/plain; charset=utf-8" },
          });
        }
        if (!nextCode) {
          return new Response("Waiting for Schwab authorization.", {
            status: 404,
            headers: { "content-type": "text/plain; charset=utf-8" },
          });
        }
        if (!stateOk) {
          return new Response("Schwab authorization state mismatch.", {
            status: 400,
            headers: { "content-type": "text/plain; charset=utf-8" },
          });
        }
        resolveCode(nextCode);
        return new Response(SUCCESS_HTML, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    });
  } catch (error) {
    if (lockRequestedPort) activeCallbackPorts.delete(requestedKey);
    throw wrapCallbackListenError(options.callbackUrl, error);
  }

  const boundKey = callbackPortKey(target.hostname, server.port ?? target.port);
  activeCallbackPorts.add(boundKey);

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    server.stop(true);
    activeCallbackPorts.delete(requestedKey);
    activeCallbackPorts.delete(boundKey);
  };

  return {
    url: `${target.protocol}://${target.hostname}:${server.port}`,
    code,
    stop,
  };
}

export async function waitForSchwabAuthorizationCode(options: {
  callbackUrl: string;
  authUrl: string;
  timeoutMs?: number;
  allowHttp?: boolean;
  expectedState?: string;
  openUrl?: (url: string) => Promise<void>;
}): Promise<string> {
  const listener = await listenForSchwabCallback({
    callbackUrl: options.callbackUrl,
    allowHttp: options.allowHttp,
    expectedState: options.expectedState ?? stateFromAuthUrl(options.authUrl),
  });
  const timeoutMs = options.timeoutMs ?? SCHWAB_CALLBACK_TIMEOUT_MS;
  const openUrl = options.openUrl ?? openSchwabAuthorizationUrl;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    try {
      await openUrl(options.authUrl);
    } catch (error) {
      const detail = error instanceof Error && error.message
        ? error.message
        : "Could not open the Schwab sign-in page.";
      throw new SchwabAuthError(
        `${detail} If the window did not open, visit ${options.authUrl}`,
        "AUTH_REQUIRED",
      );
    }
    const code = await Promise.race([
      listener.code,
      new Promise<string>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new SchwabAuthError(
            "Timed out waiting for Schwab sign-in. Try Connect again.",
            "AUTH_REQUIRED",
          ));
        }, timeoutMs);
      }),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 150));
    return code;
  } finally {
    if (timer) clearTimeout(timer);
    await listener.stop();
  }
}
