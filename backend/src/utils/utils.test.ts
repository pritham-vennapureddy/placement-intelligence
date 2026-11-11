import assert from "node:assert/strict";
import { describe, test } from "node:test";
import express from "express";
import request from "supertest";
import { validateQuery } from "../middleware/validate.js";
import { redactSensitive } from "../modules/audit/audit.service.js";
import { buildPaginationMeta, paginationQuerySchema, toPrismaPage } from "./pagination.js";
import { hashRequest, stableStringify } from "./request-hash.js";

describe("request hashing for idempotency", () => {
  test("key order does not change the hash", () => {
    assert.equal(stableStringify({ b: 1, a: [{ d: 2, c: 3 }] }), stableStringify({ a: [{ c: 3, d: 2 }], b: 1 }));
    assert.equal(hashRequest("post", "/api/x", { a: 1, b: 2 }), hashRequest("POST", "/api/x", { b: 2, a: 1 }));
  });

  test("a different body, path or method changes the hash", () => {
    const base = hashRequest("POST", "/api/x", { a: 1 });
    assert.notEqual(base, hashRequest("POST", "/api/x", { a: 2 }));
    assert.notEqual(base, hashRequest("POST", "/api/y", { a: 1 }));
    assert.notEqual(base, hashRequest("PUT", "/api/x", { a: 1 }));
  });

  test("binary bodies are hashed without JSON expansion", () => {
    const body = Buffer.from([1, 2, 3]);
    assert.equal(hashRequest("POST", "/api/upload", body), hashRequest("POST", "/api/upload", Buffer.from([1, 2, 3])));
    assert.notEqual(hashRequest("POST", "/api/upload", body), hashRequest("POST", "/api/upload", Buffer.from([1, 2, 4])));
  });
});

describe("pagination", () => {
  test("defaults, limits and offsets", () => {
    assert.deepEqual(paginationQuerySchema.parse({}), { page: 1, pageSize: 25 });
    assert.throws(() => paginationQuerySchema.parse({ pageSize: "500" }));
    assert.deepEqual(toPrismaPage({ page: 3, pageSize: 20 }), { skip: 40, take: 20 });
    assert.deepEqual(buildPaginationMeta({ page: 1, pageSize: 20 }, 41), { page: 1, pageSize: 20, total: 41, totalPages: 3 });
    assert.equal(buildPaginationMeta({ page: 1, pageSize: 20 }, 0).totalPages, 1);
  });

  test("validateQuery replaces the query with parsed values", async () => {
    const app = express();
    app.get("/", validateQuery(paginationQuerySchema), (req, res) => {
      res.json(req.query);
    });
    const response = await request(app).get("/?page=2").expect(200);
    assert.deepEqual(response.body, { page: 2, pageSize: 25 });
  });
});

describe("audit redaction", () => {
  test("removes credentials and candidate contact details at any depth", () => {
    const redacted = redactSensitive({
      name: "Asha",
      password: "x",
      contact: { email: "a@b.c", mobileNumber: "999" },
      rows: [{ refreshToken: "t", college: "IIT" }],
    });
    assert.deepEqual(redacted, {
      name: "Asha",
      password: "[REDACTED]",
      contact: { email: "[REDACTED]", mobileNumber: "[REDACTED]" },
      rows: [{ refreshToken: "[REDACTED]", college: "IIT" }],
    });
  });
});
