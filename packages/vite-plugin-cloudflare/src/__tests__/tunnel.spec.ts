import { startTunnel } from "@cloudflare/workers-utils";
import { createServer } from "vite";
import { afterEach, describe, it, onTestFinished, vi } from "vitest";
import { TunnelManager, setupTunnel } from "../plugins/tunnel";

vi.mock("@cloudflare/workers-utils");

describe("setupViteTunnel", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("starts a tunnel after the server starts listening", async ({
		expect,
	}) => {
		vi.mocked(startTunnel).mockReturnValue({
			ready: vi.fn().mockResolvedValue({
				publicUrl: new URL("https://example.trycloudflare.com"),
			}),
			dispose: vi.fn(),
		});

		const server = await createServer();
		const tunnelManager = new TunnelManager(server.config.logger);

		const info = vi
			.spyOn(server.config.logger, "info")
			.mockReturnValue(undefined);
		const warn = vi
			.spyOn(server.config.logger, "warn")
			.mockReturnValue(undefined);
		const error = vi
			.spyOn(server.config.logger, "error")
			.mockReturnValue(undefined);

		onTestFinished(() => server.close());

		await server.listen(0);
		await setupTunnel(server, tunnelManager);

		expect(startTunnel).toHaveBeenCalledWith({
			origin: new URL(server.resolvedUrls?.local?.[0] ?? ""),
			logger: expect.objectContaining({
				log: expect.any(Function),
				warn: expect.any(Function),
				debug: expect.any(Function),
			}),
		});
		expect(startTunnel).toHaveBeenCalledTimes(1);
		expect(error).not.toHaveBeenCalled();
		expect(info).toHaveBeenCalledWith(
			"  ➜  Starting tunnel (usually takes 5-15s)..."
		);
		expect(info).toHaveBeenCalledWith(
			"  ➜  Tunnel:  https://example.trycloudflare.com/"
		);
		expect(warn).toHaveBeenCalledWith(
			"Your local dev server is now publicly accessible. Anyone with this URL can access your dev server. Avoid exposing sensitive data."
		);
	});

	it("reuses the same tunnel when the origin is unchanged", async ({
		expect,
	}) => {
		vi.mocked(startTunnel)
			.mockReturnValueOnce({
				ready: vi.fn().mockResolvedValue({
					publicUrl: new URL("https://example1.trycloudflare.com"),
				}),
				dispose: vi.fn(),
			})
			.mockReturnValueOnce({
				ready: vi.fn().mockResolvedValue({
					publicUrl: new URL("https://example2.trycloudflare.com"),
				}),
				dispose: vi.fn(),
			});

		const server = await createServer();
		const tunnelManager = new TunnelManager(server.config.logger);

		onTestFinished(() => server.close());

		await server.listen(0);
		await setupTunnel(server, tunnelManager);

		expect(startTunnel).toHaveBeenCalledTimes(1);

		await server.restart();

		expect(startTunnel).toHaveBeenCalledTimes(1);

		await setupTunnel(server, tunnelManager);

		expect(startTunnel).toHaveBeenCalledTimes(1);
	});

	it("starts a new tunnel when the origin changes", async ({ expect }) => {
		vi.mocked(startTunnel).mockReturnValue({
			ready: vi.fn().mockResolvedValue({
				publicUrl: new URL("https://example.trycloudflare.com"),
			}),
			dispose: vi.fn(),
		});

		const server1 = await createServer();
		const tunnelManager = new TunnelManager(server1.config.logger);
		onTestFinished(() => server1.close());

		await server1.listen(0);
		await setupTunnel(server1, tunnelManager);

		expect(startTunnel).toHaveBeenCalledTimes(1);
		expect(startTunnel).toHaveBeenNthCalledWith(1, {
			origin: new URL(server1.resolvedUrls?.local?.[0] ?? ""),
			logger: expect.objectContaining({
				log: expect.any(Function),
				warn: expect.any(Function),
				debug: expect.any(Function),
			}),
		});

		const server2 = await createServer();
		onTestFinished(() => server2.close());

		await server2.listen(0);

		expect(server2.resolvedUrls?.local?.[0]).not.toBe(
			server1.resolvedUrls?.local?.[0]
		);

		await setupTunnel(server2, tunnelManager);

		expect(startTunnel).toHaveBeenCalledTimes(2);
		expect(startTunnel).toHaveBeenNthCalledWith(2, {
			origin: new URL(server2.resolvedUrls?.local?.[0] ?? ""),
			logger: expect.objectContaining({
				log: expect.any(Function),
				warn: expect.any(Function),
				debug: expect.any(Function),
			}),
		});
	});
});
