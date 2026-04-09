import { ParseError } from "@cloudflare/workers-utils";
import { http, HttpResponse } from "msw";
import { assert } from "vitest";
import {
	getSubdomainValues,
	getSubdomainValuesAPIMock,
} from "../../triggers/deploy";
import {
	mockGetWorkerSubdomain,
	mockUpdateWorkerSubdomain,
} from "./mock-workers-subdomain";
import { createFetchResult, msw } from "./msw";
import { serialize, toString } from "./serialize-form-data-entry";
import { readWranglerConfig } from "./write-wrangler-config";
import type { NonVersionedScriptSettings } from "../../versions/api";
import type {
	AssetConfigMetadata,
	CfWorkerInit,
	RawConfig,
	RawEnvironment,
	WorkerMetadata,
} from "@cloudflare/workers-utils";
import type { HttpResponseResolver } from "msw";

/** Create a mock handler for the request to upload a worker script. */
export function mockUploadWorkerRequest(
	options: {
		wranglerConfigPath?: string;
		expectedBaseUrl?: string;
		expectedEntry?: string | RegExp | ((entry: string | null) => void);
		expectedMainModule?: string;
		expectedType?: "esm" | "sw" | "none";
		expectedBindings?: unknown;
		expectedModules?: Record<string, string | null>;
		excludedModules?: string[];
		expectedCompatibilityDate?: string;
		expectedCompatibilityFlags?: string[];
		expectedMigrations?: CfWorkerInit["migrations"];
		expectedTailConsumers?: CfWorkerInit["tail_consumers"];
		expectedUnsafeMetaData?: Record<string, unknown>;
		expectedCapnpSchema?: string;
		expectedLimits?: CfWorkerInit["limits"];
		env?: string;
		useServiceEnvironments?: boolean;
		keepVars?: boolean;
		keepSecrets?: boolean;
		tag?: string;
		expectedDispatchNamespace?: string;
		expectedScriptName?: string;
		expectedAssets?: {
			jwt: string;
			config: AssetConfigMetadata;
		};
		useOldUploadApi?: boolean;
		expectedObservability?: CfWorkerInit["observability"];
		expectedSettingsPatch?: Partial<NonVersionedScriptSettings>;
		expectedContainers?: { class_name: string }[];
		expectedAnnotations?: Record<string, string | undefined>;
		expectedDeploymentMessage?: string;
	} = {}
) {
	const handleUpload: HttpResponseResolver = async ({ params, request }) => {
		const url = new URL(request.url);
		assert(url.hostname === (options.expectedBaseUrl ?? "api.cloudflare.com"));
		assert(params.accountId === "some-account-id");
		assert(params.scriptName === expectedScriptName);
		if (useServiceEnvironments) {
			assert(params.envName === env);
		}
		if (useOldUploadApi) {
			assert(url.searchParams.get("excludeScript") === "true");
		}
		if (expectedDispatchNamespace) {
			assert(params.dispatchNamespace === expectedDispatchNamespace);
		}

		const formBody = await request.formData();
		if (typeof expectedEntry === "string" || expectedEntry instanceof RegExp) {
			assert((await serialize(formBody.get("index.js"))) === expectedEntry);
		} else if (typeof expectedEntry === "function") {
			expectedEntry(await serialize(formBody.get("index.js")));
		}
		const metadata = JSON.parse(
			await toString(formBody.get("metadata"))
		) as WorkerMetadata;

		if (expectedType === "esm") {
			assert(metadata.main_module === expectedMainModule);
		} else if (expectedType === "none") {
			assert(metadata.main_module === undefined);
		} else {
			assert(metadata.body_part === "index.js");
		}

		if (keepVars) {
			assert(
				metadata.keep_bindings &&
					metadata.keep_bindings.length === 2 &&
					metadata.keep_bindings.includes("plain_text") &&
					metadata.keep_bindings.includes("json")
			);
		} else if (keepSecrets) {
			assert(
				metadata.keep_bindings &&
					metadata.keep_bindings.length === 2 &&
					metadata.keep_bindings.includes("secret_text") &&
					metadata.keep_bindings.includes("secret_key")
			);
		} else {
			assert(!!metadata.keep_bindings === false);
		}

		if ("expectedBindings" in options) {
			// Compare the provided bindings with the expected bindings, without requireing the order to match
			assert(
				metadata.bindings?.length === (expectedBindings as unknown[])?.length
			);
			(expectedBindings as unknown[]).forEach((binding) =>
				assert((metadata.bindings as unknown[]).includes(binding))
			);
		}
		if ("expectedCompatibilityDate" in options) {
			assert(metadata.compatibility_date === expectedCompatibilityDate);
		}
		if ("expectedCompatibilityFlags" in options) {
			assert(
				metadata.compatibility_flags?.length ===
					expectedCompatibilityFlags?.length
			);
			metadata.compatibility_flags?.forEach((flag) => {
				assert(expectedCompatibilityFlags?.includes(flag));
			});
		}
		if ("expectedMigrations" in options) {
			assert(metadata.migrations === expectedMigrations);
		}
		if ("expectedTailConsumers" in options) {
			assert(metadata.tail_consumers === expectedTailConsumers);
		}
		if ("expectedCapnpSchema" in options) {
			assert(
				(await serialize(formBody.get(metadata.capnp_schema ?? ""))) ===
					expectedCapnpSchema
			);
		}
		if ("expectedLimits" in options) {
			assert(metadata.limits === expectedLimits);
		}
		if ("expectedAssets" in options) {
			assert(metadata.assets === expectedAssets);
		}
		if ("expectedObservability" in options) {
			assert(metadata.observability === expectedObservability);
		}
		if ("expectedContainers" in options) {
			assert(metadata.containers === expectedContainers);
		}
		if ("expectedAnnotations" in options) {
			assert(metadata.annotations === expectedAnnotations);
		}

		if (expectedUnsafeMetaData !== undefined) {
			Object.keys(expectedUnsafeMetaData).forEach((key) => {
				assert(metadata[key] === expectedUnsafeMetaData[key]);
			});
		}
		for (const [name, content] of Object.entries(expectedModules)) {
			assert((await serialize(formBody.get(name))) === content);
		}
		for (const name of excludedModules) {
			assert(formBody.get(name) === null);
		}

		if (useOldUploadApi) {
			return HttpResponse.json(
				createFetchResult({
					id: "abc12345",
					etag: "etag98765",
					pipeline_hash: "hash9999",
					mutable_pipeline_id: "mutableId",
					tag: "sample-tag",
					deployment_id: "Galaxy-Class",
					startup_time_ms: 100,
				})
			);
		}

		return HttpResponse.json(
			createFetchResult({
				id: "Galaxy-Class",
				startup_time_ms: 100,
				resources: {
					script: {
						etag: "etag98765",
					},
				},
			})
		);
	};

	const {
		expectedEntry,
		expectedAssets,
		// Allow setting expectedMainModule to undefined to test static-asset only uploads
		expectedMainModule = expectedAssets
			? options.expectedMainModule
			: "index.js",
		expectedType = "esm",
		expectedBindings,
		expectedModules = {},
		excludedModules = [],
		expectedCompatibilityDate,
		expectedCompatibilityFlags,
		env = undefined,
		useServiceEnvironments = true,
		expectedMigrations,
		expectedTailConsumers,
		expectedUnsafeMetaData,
		expectedCapnpSchema,
		expectedLimits,
		expectedContainers,
		expectedAnnotations,
		keepVars,
		keepSecrets,
		expectedDispatchNamespace,
		useOldUploadApi,
		expectedObservability,
		expectedSettingsPatch,
		expectedDeploymentMessage,
	} = options;

	const expectedScriptName =
		options.expectedScriptName ??
		"test-name" + (!useServiceEnvironments && env ? `-${env}` : "");

	if (env && useServiceEnvironments) {
		msw.use(
			http.put(
				"*/accounts/:accountId/workers/services/:scriptName/environments/:envName",
				handleUpload
			)
		);
	} else if (expectedDispatchNamespace) {
		msw.use(
			http.put(
				"*/accounts/:accountId/workers/dispatch/namespaces/:dispatchNamespace/scripts/:scriptName",
				handleUpload
			)
		);
	} else if (useOldUploadApi) {
		msw.use(
			http.put(
				"*/accounts/:accountId/workers/scripts/:scriptName",
				handleUpload
			)
		);
	} else {
		msw.use(
			http.post(
				"*/accounts/:accountId/workers/scripts/:scriptName/versions",
				handleUpload
			),
			http.post(
				"*/accounts/:accountId/workers/scripts/:scriptName/deployments",
				async ({ request }) => {
					if ("expectedDeploymentMessage" in options) {
						const body = (await request.json()) as {
							annotations?: { "workers/message"?: string };
						};
						assert(
							body.annotations?.["workers/message"] ===
								expectedDeploymentMessage
						);
					}
					return HttpResponse.json(createFetchResult({ id: "Deployment-ID" }));
				}
			),
			http.patch(
				"*/accounts/:accountId/workers/scripts/:scriptName/script-settings",
				async ({ request }) => {
					const body = await request.json();

					if ("expectedSettingsPatch" in options) {
						assert(body === expectedSettingsPatch);
					}

					return HttpResponse.json(createFetchResult({}));
				}
			)
		);
	}
	// Every upload is followed by subdomain requests, to check and set subdomain status.
	// TODO: make this explicit by callers?
	let config: RawConfig = {};
	try {
		config = readWranglerConfig(options.wranglerConfigPath);
	} catch (e) {
		if (e instanceof ParseError) {
			// Ignore, config is either bad or doesn't exist.
		} else {
			throw e;
		}
	}
	let envConfig: RawEnvironment = config;
	if (env) {
		envConfig = config.env?.[env] ?? {};
	}
	const subdomainDefaults = getSubdomainValuesAPIMock(
		envConfig.workers_dev,
		envConfig.preview_urls,
		envConfig.routes ?? []
	);
	mockGetWorkerSubdomain({
		enabled: subdomainDefaults.workers_dev,
		previews_enabled: subdomainDefaults.preview_urls,
		env,
		useServiceEnvironments,
		expectedScriptName,
	});
	const subdomainValues = getSubdomainValues(
		envConfig.workers_dev,
		envConfig.preview_urls,
		envConfig.routes ?? []
	);
	mockUpdateWorkerSubdomain({
		enabled: subdomainValues.workers_dev,
		previews_enabled: subdomainValues.preview_urls,
		response: {
			enabled: subdomainDefaults.workers_dev,
			previews_enabled: subdomainDefaults.preview_urls,
		},
		env,
		useServiceEnvironments,
		expectedScriptName,
	});
}
