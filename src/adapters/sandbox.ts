import type { Sandbox, TestResult } from "../domain.js";
import { createHmac, timingSafeEqual } from "node:crypto";

export class SandboxHttpClient implements Sandbox {
  constructor(private readonly baseUrl: string, private readonly token: string, private readonly signingSecret: string, private readonly pollMs = 1000) {}

  async runTests(repository: string, commit: string): Promise<TestResult> {
    const response = await fetch(`${this.baseUrl}/v1/runs`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify({ runId: crypto.randomUUID(), repository, commit, command: ["npm", "test"], timeoutSeconds: 900 }),
    });
    if (!response.ok) throw new Error(`Sandbox rejected run (${response.status})`);
    const accepted = await response.json() as { request: { runId: string } };
    const deadline = Date.now() + 910_000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, this.pollMs));
      const statusResponse = await fetch(`${this.baseUrl}/v1/runs/${accepted.request.runId}`, { headers: { authorization: `Bearer ${this.token}` } });
      if (!statusResponse.ok) throw new Error(`Sandbox status failed (${statusResponse.status})`);
      const result = await statusResponse.json() as { request: { runId: string; commit: string }; status: string; summary?: string; exitCode?: number; signature?: string };
      if (!["passed", "failed", "cancelled"].includes(result.status)) continue;
      if (result.status === "cancelled") return { passed: false, summary: "Sandbox run cancelled" };
      const payload = JSON.stringify({ runId: result.request.runId, commit: result.request.commit, status: result.status, summary: result.summary, exitCode: result.exitCode });
      const expected = Buffer.from(createHmac("sha256", this.signingSecret).update(payload).digest("hex"));
      const received = Buffer.from(result.signature ?? "");
      if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new Error("Invalid sandbox result signature");
      return { passed: result.status === "passed", summary: result.summary ?? "No sandbox summary" };
    }
    throw new Error("Sandbox result timed out");
  }
}
