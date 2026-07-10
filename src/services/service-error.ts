/**
 * Status-coded error for shared service functions consumed by both REST routes
 * (which map `statusCode` to the HTTP response) and MCP tools (which surface
 * the message via `isError`). Generalizes the earlier SnapshotError.
 */
export class ServiceError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = 'ServiceError';
  }
}
