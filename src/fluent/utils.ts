// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors

import { KubeConfig, PatchStrategy } from "@kubernetes/client-node";
import { RequestInit } from "node-fetch";
import { URL } from "url";
import { Agent, Dispatcher } from "undici";
import { Agent as httpsAgent } from "https";
import { fetch } from "../fetch.js";
import { modelToGroupVersionKind } from "../kinds.js";
import { GenericClass } from "../types.js";
import { ApplyCfg, Filters, K8sConfigPromise, FetchMethods } from "./shared-types.js";
import fs from "fs";
import { V1Eviction as Eviction } from "@kubernetes/client-node";
const SSA_CONTENT_TYPE = "application/apply-patch+yaml";
const K8S_SA_TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token";

/**
 * Get the headers for a request
 *
 * @param token - the token from @kubernetes/client-node
 * @returns the headers for undici
 */
export async function getHeaders(token?: string | null): Promise<Record<string, string>> {
  let saToken: string | null = "";
  if (!token) {
    saToken = await getToken();
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "kubernetes-fluent-client",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  } else if (saToken) {
    headers["Authorization"] = `Bearer ${saToken}`;
  }

  return headers;
}

/**
 * Get the agent for a request
 *
 * @param opts - the request options from node-fetch
 * @returns the agent for undici
 */
export function getHTTPSAgent(opts: RequestInit): Dispatcher | undefined {
  // In cluster there will be agent - testing or dev no
  const agentOptions =
    opts.agent instanceof httpsAgent
      ? {
          ca: opts.agent.options.ca,
          cert: opts.agent.options.cert,
          key: opts.agent.options.key,
        }
      : {
          ca: undefined,
          cert: undefined,
          key: undefined,
        };

  return new Agent({
    keepAliveMaxTimeout: 600000,
    keepAliveTimeout: 600000,
    bodyTimeout: 0,
    connect: agentOptions,
  });
}
/**
 * Read the serviceAccount Token
 *
 * @returns token or null
 */
export async function getToken(): Promise<string | null> {
  try {
    return (await fs.promises.readFile(K8S_SA_TOKEN_PATH, "utf8")).trim();
  } catch {
    return null;
  }
}
/**
 * Generate a path to a Kubernetes resource
 *
 * @param serverUrl - the URL of the Kubernetes API server
 * @param model - the model to use for the API
 * @param filters - (optional) filter overrides, can also be chained
 * @param excludeName - (optional) exclude the name from the path
 * @returns the path to the resource
 */
export function pathBuilder<T extends GenericClass>(
  serverUrl: string,
  model: T,
  filters: Filters,
  excludeName = false,
) {
  const matchedKind = filters.kindOverride || modelToGroupVersionKind(model.name);

  // If the kind is not specified and the model is not a KubernetesObject, throw an error
  if (!matchedKind) {
    throw new Error(`Kind not specified for ${model.name}`);
  }

  // Use the plural property if it exists, otherwise use lowercase kind + s
  const plural = matchedKind.plural || `${matchedKind.kind.toLowerCase()}s`;

  let base = "/api/v1";

  // If the kind is not in the core group, add the group and version to the path
  if (matchedKind.group) {
    if (!matchedKind.version) {
      throw new Error(`Version not specified for ${model.name}`);
    }

    base = `/apis/${matchedKind.group}/${matchedKind.version}`;
  }

  // Namespaced paths require a namespace prefix
  const namespace = filters.namespace ? `namespaces/${filters.namespace}` : "";

  // Name should not be included in some paths
  const name = excludeName ? "" : filters.name;

  // Build the complete path to the resource
  const path = [base, namespace, plural, name].filter(Boolean).join("/");

  // Generate the URL object
  const url = new URL(path, serverUrl);

  // Add field selectors to the query params
  if (filters.fields) {
    const fieldSelector = Object.entries(filters.fields)
      .map(([key, value]) => `${key}=${value}`)
      .join(",");

    url.searchParams.set("fieldSelector", fieldSelector);
  }

  // Add label selectors to the query params
  if (filters.labels) {
    const labelSelector = Object.entries(filters.labels)
      // Exists set-based operators only include the key
      // See https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/#set-based-requirement
      .map(([key, value]) => (value ? `${key}=${value}` : key))
      .join(",");

    url.searchParams.set("labelSelector", labelSelector);
  }

  return url;
}

/**
 * Sets up the kubeconfig and https agent for a request
 *
 * A few notes:
 * - The kubeconfig is loaded from the default location, and can check for in-cluster config
 * - We have to create an agent to handle the TLS connection (for the custom CA + mTLS in some cases)
 * - The K8s lib uses request instead of node-fetch today so the object is slightly different
 *
 * @param method - the HTTP method to use
 * @returns the fetch options and server URL
 */
export async function k8sCfg(method: FetchMethods): K8sConfigPromise {
  const kubeConfig = new KubeConfig();
  kubeConfig.loadFromDefault();

  const cluster = kubeConfig.getCurrentCluster();
  if (!cluster) {
    throw new Error("No currently active cluster");
  }

  // Get TLS Options
  const opts = await kubeConfig.applyToFetchOptions({});

  // Extract the headers from the options object
  const symbols = Object.getOwnPropertySymbols(opts.headers);
  const headersMap = symbols
    .map(symbol => Object.getOwnPropertyDescriptor(opts.headers, symbol)?.value)
    .find(value => typeof value === "object" && value !== null) as
    | Record<string, string[]>
    | undefined;

  // Extract the Authorization header
  const extractedHeaders: Record<string, string | undefined> = {
    Authorization: headersMap?.["Authorization"]?.[0]?.split(" ")[1],
  };

  const undiciRequestUnit = {
    headers: await getHeaders(extractedHeaders["Authorization"]),
    method,
    dispatcher: getHTTPSAgent(opts),
  };
  return { opts: undiciRequestUnit, serverUrl: cluster.server };
}

const isEvictionPayload = (payload: unknown): payload is Eviction =>
  payload !== null &&
  payload !== undefined &&
  typeof payload === "object" &&
  "kind" in payload &&
  (payload as { kind: string }).kind === "Eviction";

/**
 * Prepares and mutates the request options and URL for Kubernetes PATCH or APPLY operations.
 *
 * This function modifies the request's HTTP method, headers, and URL based on the operation type.
 * It handles the following:
 *
 * - `PATCH_STATUS`: Converts the method to `PATCH`, appends `/status` to the path, sets merge patch headers,
 *   and rewrites the payload to contain only the `status` field.
 * - `PATCH`: Sets the content type to `application/json-patch+json`.
 * - `APPLY`: Converts the method to `PATCH`, sets server-side apply headers, and updates the query string
 *   with field manager and force options.
 *
 * @template K
 * @param methodPayload - The original method and payload. May be mutated if `PATCH_STATUS` is used.
 * @param opts - The request options.
 * @param opts.method - The HTTP method (e.g. `PATCH`, `APPLY`, or `PATCH_STATUS`).
 * @param opts.headers - The headers to be updated with the correct content type.
 * @param url - The URL to mutate with subresource path or query parameters.
 * @param applyCfg - Server-side apply options, such as `force`.
 */
export function prepareRequestOptions<K>(
  methodPayload: MethodPayload<K>,
  opts: { method?: string; headers?: Record<string, string> },
  url: URL,
  applyCfg: ApplyCfg,
): void {
  switch (opts.method) {
    // PATCH_STATUS is a special case that uses the PATCH method on status subresources
    case "PATCH_STATUS":
      opts.method = "PATCH";
      url.pathname = `${url.pathname}/status`;
      (opts.headers as Record<string, string>)["Content-Type"] = PatchStrategy.MergePatch;
      methodPayload.payload = { status: (methodPayload.payload as { status: unknown }).status };
      break;

    case "PATCH":
      (opts.headers as Record<string, string>)["Content-Type"] = PatchStrategy.JsonPatch;
      break;

    case "APPLY":
      (opts.headers as Record<string, string>)["Content-Type"] = SSA_CONTENT_TYPE;
      opts.method = "PATCH";
      url.searchParams.set("fieldManager", "pepr");
      url.searchParams.set("fieldValidation", "Strict");
      url.searchParams.set("force", applyCfg.force ? "true" : "false");
      break;
  }
}

export type MethodPayload<K> = {
  method: FetchMethods;
  payload?: K | unknown;
  subResourceConfig?: SubResourceConfig;
};

export type SubResourceConfig = {
  ProxyConfig?: {
    port: string;
  };
  ScaleConfig?: {
    replicas: number;
  };
};

/**
 * Execute a request against the Kubernetes API server.
 *
 * @param model - the model to use for the API
 * @param filters - (optional) filter overrides, can also be chained
 * @param methodPayload - method and payload for the request
 * @param applyCfg - (optional) configuration for the apply method
 *
 * @returns the parsed JSON response
 */
export async function k8sExec<T extends GenericClass, K>(
  model: T,
  filters: Filters,
  methodPayload: MethodPayload<K>,
  applyCfg: ApplyCfg = { force: false },
) {
  const reconstruct = async (method: FetchMethods): K8sConfigPromise => {
    const configMethod = method === FetchMethods.LOG ? FetchMethods.GET : method;
    const { opts, serverUrl } = await k8sCfg(configMethod);

    // Build the base path once, using excludeName only for standard POST requests
    const shouldExcludeName =
      method === FetchMethods.POST &&
      !(methodPayload.payload && isEvictionPayload(methodPayload.payload));
    const baseUrl = pathBuilder(serverUrl.toString(), model, filters, shouldExcludeName);

    // Append appropriate subresource paths
    if (methodPayload.payload && isEvictionPayload(methodPayload.payload)) {
      baseUrl.pathname = `${baseUrl.pathname}/eviction`;
    } else if (method === FetchMethods.LOG) {
      baseUrl.pathname = `${baseUrl.pathname}/log`;
    }

    baseUrl.pathname = handleSubResourceConfig(
      model.name,
      baseUrl.pathname,
      methodPayload.subResourceConfig,
    );

    return {
      serverUrl: baseUrl,
      opts,
    };
  };

  const { opts, serverUrl } = await reconstruct(methodPayload.method);
  const url: URL = serverUrl instanceof URL ? serverUrl : new URL(serverUrl);

  prepareRequestOptions(
    methodPayload,
    opts as { method?: string; headers?: Record<string, string> },
    url,
    applyCfg,
  );

  if (methodPayload.payload) {
    opts.body = JSON.stringify(methodPayload.payload);
  }

  const resp = await fetch<K>(url, opts);

  if (resp.ok) {
    return resp.data;
  }

  if (resp.status === 404 && methodPayload.method === FetchMethods.PATCH_STATUS) {
    resp.statusText =
      "Not Found" + " (NOTE: This error is expected if the resource has no status subresource)";
  }

  throw resp;
}

/**
 * Handles subresource configuration for specific Kubernetes resources.
 *
 * @param kind - The kind of the Kubernetes resource (e.g., "Pod", "Service", "Node").
 * @param urlPath - The base URL path to append the subresource to.
 * @param subResourceConfig - The subresource configuration object.
 * @returns The modified URL path with the subresource appended, or the urlPath if no subresource is configured.
 * @throws Error if the kind is not supported for proxy configuration.
 */
export function handleSubResourceConfig(
  kind: string,
  urlPath: string,
  subResourceConfig?: SubResourceConfig,
): string {
  if (subResourceConfig && subResourceConfig.ProxyConfig) {
    if (kind !== "V1Pod" && kind !== "V1Service" && kind !== "V1Node") {
      throw new Error("Proxy is only supported for Pod, Service, and Node resources");
    }
    if (!subResourceConfig.ProxyConfig.port) {
      return `${urlPath}/proxy`;
    } else {
      return `${urlPath}:${subResourceConfig.ProxyConfig.port}/proxy`;
    }
  }

  if (subResourceConfig && subResourceConfig.ScaleConfig) {
    if (kind !== "V1Deployment" && kind !== "V1ReplicaSet" && kind !== "V1StatefulSet") {
      throw new Error(
        "Scale is only supported for Deployment, ReplicaSet, and StatefulSet resources",
      );
    }
    return `${urlPath}/scale`;
  }
  return urlPath;
}
