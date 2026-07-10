/**
 * Status-coded error for shared service functions consumed by both REST routes
 * (which map `statusCode` to the HTTP response) and MCP tools (which surface
 * the message via `isError`). Generalizes the earlier SnapshotError.
 */
export class ServiceError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    /** Extra fields merged into the REST error body (e.g. a machine code). */
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}
