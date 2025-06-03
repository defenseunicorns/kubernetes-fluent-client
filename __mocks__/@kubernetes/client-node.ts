// __mocks__/@kubernetes/client-node.ts

import * as k8s from "@kubernetes/client-node";
import { jest } from "@jest/globals";
import { RequestOptions } from "https";
import { HeaderInit, Headers } from "node-fetch";

// Create a module with all the original exports
const mockedModule = { ...k8s };

// Override KubeConfig by extending the original class
mockedModule.KubeConfig = class MockedKubeConfig extends k8s.KubeConfig {
  loadFromDefault = jest.fn();

  applyToFetchOptions = jest.fn((data: RequestOptions) => {
    return Promise.resolve({
      method: data.method,
      headers: new Headers(data.headers as HeaderInit),
    });
  });

  getCurrentCluster = jest.fn<() => k8s.Cluster | null>().mockReturnValue({
    server: "http://jest-test:8080",
    name: "test-cluster",
    caFile: "",
    caData: "",
    skipTLSVerify: false,
  } as k8s.Cluster);
};

// Export all elements of the module
module.exports = mockedModule;
