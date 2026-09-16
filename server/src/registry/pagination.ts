import { RegistryError } from "./errors";
import type { Page } from "@dairy/shared";
export function invalid(message: string): never {
  throw new RegistryError("invalid_payload", message);
}
export function scalar(value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string")
    return invalid("Query parameters must be single text values.");
  return value;
}
export function pageRows<T>(
  rows: readonly T[],
  query: Record<string, unknown>,
  sorts: Record<string, (a: T, b: T) => number>,
  defaultSort: string,
  tie: (a: T, b: T) => number,
): Page<T> {
  const requested = scalar(query.page, "1"),
    size = scalar(query.pageSize, "25");
  if (!/^[1-9]\d*$/.test(requested) || !Number.isSafeInteger(Number(requested)))
    invalid("page must be a positive integer.");
  if (!["25", "50", "100"].includes(size))
    invalid("pageSize must be 25, 50 or 100.");
  const sort = scalar(query.sort, defaultSort),
    direction = scalar(
      query.direction,
      defaultSort === "date" ? "desc" : "asc",
    );
  if (
    !Object.prototype.hasOwnProperty.call(sorts, sort) ||
    !["asc", "desc"].includes(direction)
  )
    invalid("Unsupported sort or direction.");
  const pageSize = Number(size),
    totalItems = rows.length,
    totalPages = Math.ceil(totalItems / pageSize);
  const page = Math.min(Number(requested), Math.max(1, totalPages));
  const ordered = [...rows].sort(
    (a, b) => (direction === "desc" ? -1 : 1) * sorts[sort](a, b) || tie(a, b),
  );
  return {
    items: ordered.slice((page - 1) * pageSize, page * pageSize),
    page,
    pageSize,
    totalItems,
    totalPages,
    sort,
    direction,
  };
}
