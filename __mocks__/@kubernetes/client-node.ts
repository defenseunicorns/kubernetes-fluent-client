// __mocks__/@kubernetes/client-node.ts

import { jest } from "@jest/globals";

const actual = jest.requireActual("@kubernetes/client-node") as any;

const cloned = { ...actual };

cloned.KubeConfig = class MockedKubeConfig {
  loadFromDefault = jest.fn();

  applyToFetchOptions = jest.fn(data => data);

  getCurrentCluster = jest.fn().mockReturnValue({
    server: "http://jest-test:8080",
  });
};

// export all elements of the mocked module
module.exports = cloned;
