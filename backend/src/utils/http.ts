import type { Response } from "express";
import type { ApiSuccess, PaginationMeta } from "@placement/shared";

export function sendData<T>(response: Response, data: T, status = 200, meta?: PaginationMeta): void {
  const body: ApiSuccess<T> = meta ? { data, meta } : { data };
  response.status(status).json(body);
}

export function sendCreated<T>(response: Response, data: T): void {
  sendData(response, data, 201);
}

export function sendNoContent(response: Response): void {
  response.status(204).end();
}
