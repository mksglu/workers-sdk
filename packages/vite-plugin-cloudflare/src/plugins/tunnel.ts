import { startTunnel } from "@cloudflare/workers-utils";
import colors from "picocolors";
import { assertIsNotPreview } from "../context";
import { debuglog, createPlugin } from "../utils";
import type { Tunnel } from "@cloudflare/workers-utils";
import type * as vite from "vite";

export class TunnelManager {
	#logger: vite.Logger;
	#origin?: string;
	#tunnel?: Tunnel;

	constructor(logger: vite.Logger) {
		this.#logger = logger;
	}

	isStarted(origin: string): boolean {
		return this.#origin === origin && this.#tunnel !== undefined;
	}

	async startTunnel(origin: string): Promise<string | null> {
		if (this.#origin === origin && this.#tunnel) {
			return await this.#waitForPublicUrl(this.#tunnel);
		}

		const previousController = this.#tunnel;
		if (previousController) {
			void previousController.dispose();
		}

		this.#origin = origin;

		const tunnel = startTunnel({
			origin: new URL(origin),
			logger: {
				log: (message) => this.#logger.info(message),
				warn: (message) => this.#logger.warn(message),
				debug: (message) => debuglog(message),
			},
		});
		this.#tunnel = tunnel;

		return await this.#waitForPublicUrl(tunnel);
	}

	async #waitForPublicUrl(tunnel: Tunnel): Promise<string | null> {
		try {
			const { publicUrl } = await tunnel.ready();
			if (this.#tunnel !== tunnel) {
				return null;
			}

			return publicUrl.toString();
		} catch (error) {
			if (this.#tunnel !== tunnel) {
				return null;
			}

			this.#tunnel = undefined;
			throw error;
		}
	}

	async dispose() {
		const tunnel = this.#tunnel;

		this.#origin = undefined;
		this.#tunnel = undefined;

		if (tunnel) {
			await tunnel.dispose();
		}
	}
}

let tunnelManager: TunnelManager | undefined = undefined;

process.on("exit", () => {
	void tunnelManager?.dispose();
});

async function getTunnelOrigin(server: vite.ViteDevServer) {
	if (!server.httpServer?.listening) {
		await new Promise<void>((resolve) => {
			server.httpServer?.once("listening", () => resolve());
		});
	}

	const url =
		server.resolvedUrls?.local?.[0] ?? server.resolvedUrls?.network?.[0];

	if (!url) {
		throw new Error(
			"Could not determine the local dev server URL for tunnel sharing."
		);
	}

	return url;
}

export async function setupTunnel(
	server: vite.ViteDevServer,
	manager: TunnelManager
) {
	try {
		const origin = await getTunnelOrigin(server);

		if (manager.isStarted(origin)) {
			return;
		}

		server.config.logger.info(
			colors.dim("  ➜") +
				colors.dim("  Starting tunnel (usually takes 5-15s)...")
		);

		const publicURL = await manager.startTunnel(origin);

		if (!publicURL) {
			// This happens if the tunnel was restarted with a different origin before the first tunnel finished starting.
			// In this case, we don't want to log anything since the new tunnel will log its own URL once it's ready.
			return;
		}

		server.config.logger.warn(
			"Your local dev server is now publicly accessible. Anyone with this URL can access your dev server. Avoid exposing sensitive data."
		);
		server.config.logger.info(
			`  ${colors.green("➜")}  ${colors.bold("Tunnel")}:  ${colors.dim(
				colors.yellow(publicURL)
			)}`
		);
	} catch (error) {
		server.config.logger.error(
			`Failed to start tunnel: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

export const tunnelPlugin = createPlugin("tunnel", (ctx) => {
	return {
		async buildEnd() {
			if (!ctx.isRestartingDevServer) {
				await tunnelManager?.dispose();
			}
		},
		async configureServer(server) {
			assertIsNotPreview(ctx);

			if (!ctx.resolvedPluginConfig.tunnel) {
				await tunnelManager?.dispose();
				return;
			}

			tunnelManager ??= new TunnelManager(server.config.logger);

			await setupTunnel(server, tunnelManager);
		},
	};
});
