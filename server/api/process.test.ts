import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { handleProcessMov } from "./process";

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("handleProcessMov", () => {
  test("rejects empty recording files before invoking ffmpeg", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "meeting-rec-process-"));
    const movPath = join(tempDir, "empty.mov");
    await writeFile(movPath, "");

    const response = await handleProcessMov(
      new Request("http://localhost/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ movPath }),
      }),
    );

    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain("empty");
  });

  test("returns ffmpeg output when audio extraction fails", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "meeting-rec-process-"));
    const movPath = join(tempDir, "invalid.mov");
    await writeFile(movPath, "not a valid mov file");

    const response = await handleProcessMov(
      new Request("http://localhost/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ movPath }),
      }),
    );

    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toContain("ffmpeg failed");
    expect(body.error).not.toContain("Failed with exit code");
  });
});
