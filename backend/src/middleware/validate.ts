import type { RequestHandler } from "express";
import type { ZodType } from "zod";

export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return (request, _response, next) => {
    request.body = schema.parse(request.body);
    next();
  };
}

// Express 5 exposes `query` as a getter, so the parsed value is redefined on the request.
export function validateQuery<T>(schema: ZodType<T>): RequestHandler {
  return (request, _response, next) => {
    Object.defineProperty(request, "query", {
      value: schema.parse(request.query),
      writable: true,
      configurable: true,
      enumerable: true,
    });
    next();
  };
}

export function validateParams<T extends Record<string, unknown>>(schema: ZodType<T>): RequestHandler {
  return (request, _response, next) => {
    request.params = schema.parse(request.params) as typeof request.params;
    next();
  };
}
