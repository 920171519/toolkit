export class DomainError extends Error {
  code: string;

  constructor(message: string, code = "DOMAIN_ERROR") {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

export function assert(condition: unknown, message: string, code = "DOMAIN_ERROR"): asserts condition {
  if (!condition) throw new DomainError(message, code);
}
