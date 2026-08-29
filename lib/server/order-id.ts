import { randomBytes } from "node:crypto";

export function createServerOrderId(now = new Date()) {
  const year = now.getFullYear();
  const suffix = randomBytes(4).toString("hex").toUpperCase();

  return `KG-${year}-${suffix}`;
}
