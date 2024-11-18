// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors

import { expect, test, beforeEach, afterEach } from "@jest/globals";
import { StatusCodes } from "http-status-codes";
import { RequestInit } from "undici";
import { fetch } from "./fetch";
import { MockAgent, setGlobalDispatcher } from "undici";

let mockAgent: MockAgent;
interface Todo {
  userId: number;
  id: number;
  title: string;
  completed: boolean;
}
beforeEach(() => {
  mockAgent = new MockAgent();
  setGlobalDispatcher(mockAgent);
  mockAgent.disableNetConnect();

  const mockClient = mockAgent.get("https://jsonplaceholder.typicode.com");

  mockClient.intercept({ path: "/todos/1", method: "GET" }).reply(
    StatusCodes.OK,
    {
      userId: 1,
      id: 1,
      title: "Example title",
      completed: false,
    },
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
    },
  );

  mockClient.intercept({ path: "/todos", method: "POST" }).reply(
    StatusCodes.OK,
    { title: "test todo", userId: 1, completed: false },
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
    },
  );

  mockClient
    .intercept({ path: "/todos/empty-null", method: "GET" })
    .reply(StatusCodes.OK, undefined);

  mockClient.intercept({ path: "/todos/empty-string", method: "GET" }).reply(StatusCodes.OK, "");

  mockClient.intercept({ path: "/todos/empty-object", method: "GET" }).reply(StatusCodes.OK, {});

  mockClient
    .intercept({ path: "/todos/invalid", method: "GET" })
    .replyWithError(new Error("Something bad happened"));
});

afterEach(() => {
  mockAgent.close();
});

test("fetch: should return without type data", async () => {
  const url = "https://jsonplaceholder.typicode.com/todos/1";
  const requestOptions: RequestInit = {
    method: "GET",
    headers: {
      hi: "there",
      "content-type": "application/json; charset=UTF-8",
    },
  };
  const { data, ok } = await fetch<Todo>(url, requestOptions);
  expect(ok).toBe(true);
  expect(data.title).toBe("Example title");
});

test("fetch: should return parsed JSON response as a specific type", async () => {
  const url = "https://jsonplaceholder.typicode.com/todos/1";
  const requestOptions: RequestInit = {
    method: "GET",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
    },
  };
  const res = await fetch<Todo>(url, requestOptions);
  expect(res.ok).toBe(true);

  expect(res.data.id).toBe(1);
  expect(typeof res.data.title).toBe("string");
  expect(typeof res.data.completed).toBe("boolean");
});

test("fetch: should handle additional request options", async () => {
  const url = "https://jsonplaceholder.typicode.com/todos";
  const requestOptions: RequestInit = {
    method: "POST",
    body: JSON.stringify({
      title: "test todo",
      userId: 1,
      completed: false,
    }),
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
    },
  };

  const res = await fetch<Todo>(url, requestOptions);
  expect(res.ok).toBe(true);
  expect(res.data).toStrictEqual({ title: "test todo", userId: 1, completed: false });
});

test("fetch: should handle empty (null) responses", async () => {
  const url = "https://jsonplaceholder.typicode.com/todos/empty-null";
  const resp = await fetch(url);
  expect(resp.data).toBe("");
  expect(resp.ok).toBe(true);
  expect(resp.status).toBe(StatusCodes.OK);
});

test("fetch: should handle empty (string) responses", async () => {
  const url = "https://jsonplaceholder.typicode.com/todos/empty-string";
  const resp = await fetch(url);
  expect(resp.data).toBe("");
  expect(resp.ok).toBe(true);
  expect(resp.status).toBe(StatusCodes.OK);
});

test("fetch: should handle empty (object) responses", async () => {
  const url = "https://jsonplaceholder.typicode.com/todos/empty-object";
  const resp = await fetch(url);
  expect(resp.data).toEqual("{}");
  expect(resp.ok).toBe(true);
  expect(resp.status).toBe(StatusCodes.OK);
});

test("fetch: should handle failed requests without throwing an error", async () => {
  const url = "https://jsonplaceholder.typicode.com/todos/invalid";
  const resp = await fetch(url);

  expect(resp.data).toBe(undefined);
  expect(resp.ok).toBe(false);
  expect(resp.status).toBe(StatusCodes.BAD_REQUEST);
});

test("fetch wrapper respects MockAgent", async () => {
  const mockClient = mockAgent.get("https://example.com");

  mockClient.intercept({ path: "/test", method: "GET" }).reply(
    200,
    { success: true },
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
    },
  );

  const response = await fetch<{ success: boolean }>("https://example.com/test");

  expect(response.ok).toBe(true);
  expect(response.data).toEqual({ success: true });
});

// let ff = () => {
//   return fetch(url, opts)
//   .then(response => {
//     for (const [key, value] of response.headers) {
//       console.log(`${key}: ${value}`);
//     }
//      return response.json()
//     })
//     .then(data => console.log(data.title))
// }
