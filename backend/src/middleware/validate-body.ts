import type { RequestHandler } from "express";
import type { ZodType } from "zod";

export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return (request, _response, next) => {
    const parsed = schema.safeParse(request.body);

    if (!parsed.success) {
      next(parsed.error);
      return;
    }

    request.body = parsed.data;
    next();
  };
}
