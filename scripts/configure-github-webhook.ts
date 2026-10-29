import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

const url = process.argv[2];
if (!url || !/^https:\/\/[-a-z0-9.]+\/webhooks\/github$/i.test(url)) {
  throw new Error("Usage: configure-github-webhook.ts https://host/webhooks/github");
}

const now = Math.floor(Date.now() / 1000);
const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: required("GITHUB_APP_ID") }));
const unsigned = `${header}.${payload}`;
const privateKey = await readFile(required("GITHUB_APP_PRIVATE_KEY_PATH"), "utf8");
const jwt = `${unsigned}.${base64url(createSign("RSA-SHA256").update(unsigned).sign(privateKey))}`;

const response = await fetch("https://api.github.com/app/hook/config", {
  method: "PATCH",
  headers: {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${jwt}`,
    "content-type": "application/json",
    "x-github-api-version": "2026-03-10",
  },
  body: JSON.stringify({
    url,
    content_type: "json",
    insecure_ssl: "0",
    secret: required("GITHUB_WEBHOOK_SECRET"),
  }),
});

if (!response.ok) throw new Error(`GitHub webhook update failed (${response.status})`);
const result = await response.json() as { url?: string; insecure_ssl?: string };
if (result.url !== url || result.insecure_ssl !== "0") throw new Error("GitHub returned an unexpected webhook configuration");
console.log(`GitHub webhook configured: ${url}`);
