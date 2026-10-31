import assert from "node:assert/strict";
import { describe, test } from "node:test";
import express, { type ErrorRequestHandler } from "express";
import request from "supertest";
import { hasPermission, PERMISSIONS, ROLE_PERMISSIONS } from "@placement/shared";
import { ApiError } from "../utils/api-error.js";
import { requirePermission } from "./authorize.js";

function appWithUser(roles: string[] | null) {
  const app = express();
  app.use((req, _res, next) => {
    if (roles) req.user = { id: "u1", roles };
    next();
  });
  app.get("/admin-only", requirePermission("user:manage"), (_req, res) => {
    res.json({ data: "ok" });
  });
  app.get("/pii", requirePermission("candidate:read", "candidate:pii:read"), (_req, res) => {
    res.json({ data: "ok" });
  });
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    const status = error instanceof ApiError ? error.statusCode : 500;
    res.status(status).json({ error: { code: error instanceof ApiError ? error.code : "INTERNAL" } });
  };
  app.use(errors);
  return app;
}

describe("requirePermission", () => {
  test("returns 401 when no user is attached", async () => {
    await request(appWithUser(null)).get("/admin-only").expect(401);
  });

  test("allows a role that holds the permission and forbids one that does not", async () => {
    await request(appWithUser(["ADMIN"])).get("/admin-only").expect(200);
    const response = await request(appWithUser(["MANAGER"])).get("/admin-only").expect(403);
    assert.equal(response.body.error.code, "FORBIDDEN");
  });

  test("requires every listed permission", async () => {
    await request(appWithUser(["PSM"])).get("/pii").expect(200);
    await request(appWithUser(["VIEWER"])).get("/pii").expect(403);
  });
});

describe("role permission map", () => {
  test("administrators hold every permission", () => {
    for (const permission of PERMISSIONS) {
      assert.ok(hasPermission(["ADMIN"], permission), permission);
    }
  });

  test("viewers cannot see candidate PII or change anything", () => {
    for (const permission of ROLE_PERMISSIONS.VIEWER) {
      assert.match(permission, /:read$/);
    }
    assert.equal(hasPermission(["VIEWER"], "candidate:pii:read"), false);
  });

  test("only administrators manage users and teams", () => {
    for (const role of ["MANAGER", "PSM", "VIEWER"]) {
      assert.equal(hasPermission([role], "user:manage"), false, role);
      assert.equal(hasPermission([role], "team:manage"), false, role);
    }
  });

  test("unknown roles grant nothing, and multiple roles combine", () => {
    assert.equal(hasPermission(["SUPERUSER"], "dashboard:read"), false);
    assert.ok(hasPermission(["VIEWER", "PSM"], "screening:write"));
  });
});
