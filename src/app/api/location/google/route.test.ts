import { afterEach, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("configuration endpoint discloses only availability, not a key", async () => {
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "synthetic-test-key-never-real");
  expect(await (await GET()).json()).toEqual({ configured: true });
});
it("legitimate localhost proxy Host passes origin protection but missing key prevents upstream calls", async () => {
  vi.stubEnv("GOOGLE_MAPS_API_KEY", ""); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const request = new Request("http://localhost:3000/api/location/google", { method: "POST", headers: { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000", "Content-Type": "application/json" }, body: JSON.stringify({ action: "autocomplete", input: "Test", sessionToken: "test" }) });
  const response = await POST(request); expect(response.status).toBe(503); expect((await response.json()).code).toBe("GOOGLE_NOT_CONFIGURED"); expect(fetcher).not.toHaveBeenCalled();
});
it("rejects a different origin", async () => {
  expect((await POST(new Request("http://127.0.0.1:3000/api/location/google", { method: "POST", headers: { origin: "https://example.com" } }))).status).toBe(403);
});
