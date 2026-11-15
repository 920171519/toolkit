import "server-only";

import { redirect } from "next/navigation";
import { DomainError } from "./services";
import type { ActionState } from "./action-state";

export function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function raw(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export function numberValue(formData: FormData, key: string): number | null {
  const value = text(formData, key);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function idList(formData: FormData, key: string): number[] {
  return formData
    .getAll(key)
    .filter((value): value is string => typeof value === "string" && value !== "")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
}

export function checkbox(formData: FormData, key: string): boolean {
  return formData.get(key) === "on" || formData.get(key) === "true" || formData.get(key) === "1";
}

export function failure(error: unknown): ActionState {
  if (error instanceof DomainError) {
    return { error: error.message };
  }
  console.error(error);
  return { error: "操作未完成，系统出现异常，请稍后重试。" };
}

export function successRedirect(path: string, message: string): never {
  const separator = path.includes("?") ? "&" : "?";
  redirect(`${path}${separator}flash=${encodeURIComponent(message)}`);
}

export function errorRedirect(path: string, message: string): never {
  const separator = path.includes("?") ? "&" : "?";
  redirect(`${path}${separator}flash=${encodeURIComponent(message)}&tone=error`);
}
