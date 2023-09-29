// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Pepr Authors

import { describe, jest } from "@jest/globals";
import { stuff } from "./stuff";

jest.deepUnmock("@kubernetes/client-node");
jest.deepUnmock("node-fetch");
jest.deepUnmock("../src/fetch.ts");
jest.deepUnmock("../src/fluent/watch");


// Configure the test environment before running the tests
describe("Journey: Stuff", stuff);

