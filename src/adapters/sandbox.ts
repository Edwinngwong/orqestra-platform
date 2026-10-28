import type { Sandbox, TestResult } from "../domain.js";

export class SandboxHttpClient implements Sandbox {
  constructor(private readonly baseUrl: string, private readonly token: string) {}

  async runTests(repository: string, commit: string): Promise<TestResult> {
    const response = await fetch(`${this.baseUrl}/v1/runs`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify({ runId: crypto.randomUUID(), repository, commit, command: ["npm", "test"], timeoutSeconds: 900 }),
    });
    if (!response.ok) throw new Error(`Sandbox rejected run (${response.status})`);
    const result = await response.json() as { status: string; summary?: string };
    // The scaffold sandbox is asynchronous. A production adapter will poll or consume
    // signed completion events; do not interpret acceptance as a passing test run.
    return { passed: result.status === "passed", summary: result.summary ?? `Sandbox status: ${result.status}` };
  }
}
