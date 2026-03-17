import { describe, it, expect } from "vitest";
import { isSdkAvailable, SdkSessionWrapper, createSdkSession } from "../src/sdk-session.ts";

describe("sdk-session", () => {
  it("isSdkAvailable returns boolean", () => {
    expect(typeof isSdkAvailable()).toBe("boolean");
  });
  it("SdkSessionWrapper has create method", () => {
    const w = new SdkSessionWrapper();
    expect(typeof w.create).toBe("function");
  });
  it("isAlive is false before create", () => {
    const w = new SdkSessionWrapper();
    expect(w.isAlive()).toBe(false);
  });
  it("getCost returns null before create", () => {
    const w = new SdkSessionWrapper();
    expect(w.getCost()).toBeNull();
  });
  it("isAlive is true after create", async () => {
    const w = new SdkSessionWrapper();
    await w.create({ projectDir: "/tmp" });
    expect(w.isAlive()).toBe(true);
  });
  it("isAlive is false after terminate", async () => {
    const w = new SdkSessionWrapper();
    await w.create({ projectDir: "/tmp" });
    await w.terminate();
    expect(w.isAlive()).toBe(false);
  });
  it("createSdkSession returns wrapper", async () => {
    const w = await createSdkSession({ projectDir: "/tmp" });
    expect(w).toBeInstanceOf(SdkSessionWrapper);
    expect(w.isAlive()).toBe(true);
  });
  it("send yields at least one chunk", async () => {
    const w = new SdkSessionWrapper();
    await w.create({ projectDir: "/tmp" });
    const chunks: any[] = [];
    for await (const c of w.send("test")) chunks.push(c);
    expect(chunks.length).toBeGreaterThan(0);
  });
});
