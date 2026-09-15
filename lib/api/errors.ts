export type ErrorCode =
  | "validation_error"
  | "not_found"
  | "conflict"
  | "executor_unreachable"
  | "executor_error"
  | "internal_error"

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number
  ) {
    super(message)
    this.name = "ApiError"
  }
}

export const notFound = (what: string) =>
  new ApiError("not_found", `${what} not found`, 404)
export const conflict = (message: string) =>
  new ApiError("conflict", message, 409)
