// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Pepr Authors

import { KubeConfig, PatchStrategy } from "@kubernetes/client-node";

import { Headers } from "node-fetch";
import { URL } from "url";
import { fetch } from "../fetch";
import { modelToGroupVersionKind } from "../kinds";
import { GenericClass } from "../types";
import { FetchMethods, Filters } from "./types";

const SSA_CONTENT_TYPE = "application/apply-patch+yaml";

/**
 * Generate a path to a Kubernetes resource
 *
 * @param serverUrl
 * @param model
 * @param filters
 * @param excludeName
 * @returns
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
      .map(([key, value]) => `${key}=${value}`)
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
 * @param method
 * @returns
 */
export async function k8sCfg(method: FetchMethods) {
  const kubeConfig = new KubeConfig();
  kubeConfig.loadFromDefault();

  const cluster = kubeConfig.getCurrentCluster();
  if (!cluster) {
    throw new Error("No currently active cluster");
  }

  // Setup the TLS options & auth headers, as needed
  const opts = await kubeConfig.applyToFetchOptions({
    method,
    headers: {
      // Set the default content type to JSON
      "Content-Type": "application/json",
      // Set the user agent like kubectl does
      "User-Agent": `kubernetes-fluent-client`,
    },
  });

  // Enable compression
  opts.compress = true;

  return { opts, serverUrl: cluster.server };
}

export async function k8sExec<T extends GenericClass, K>(
  model: T,
  filters: Filters,
  method: FetchMethods,
  payload?: K | unknown,
) {
  const { opts, serverUrl } = await k8sCfg(method);
  const url = pathBuilder(serverUrl, model, filters, method === "POST");

  switch (opts.method) {
    case "PATCH":
      (opts.headers as Headers).set("Content-Type", PatchStrategy.JsonPatch);
      break;

    case "FORCEAPPLY":
    case "APPLY":
      (opts.headers as Headers).set("Content-Type", SSA_CONTENT_TYPE);
      url.searchParams.set("force", opts.method === "FORCEAPPLY" ? "true" : "false");
      opts.method = "PATCH";
      url.searchParams.set("fieldManager", "pepr");
      url.searchParams.set("fieldValidation", "Strict");
      break;
  }

  if (payload) {
    opts.body = JSON.stringify(payload);
  }

  const resp = await fetch<K>(url, opts);

  if (resp.ok) {
    return resp.data;
  }

  throw resp;
}
