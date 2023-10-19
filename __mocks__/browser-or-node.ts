// mock the browser-or-node module

import { jest } from "@jest/globals";

jest.mock("browser-or-node", () => ({
  isBrowser: false,
  isNode: true,
}));
