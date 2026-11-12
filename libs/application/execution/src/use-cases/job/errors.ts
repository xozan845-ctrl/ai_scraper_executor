/** Errores de aplicación de jobs; el borde HTTP los traduce a su status. */
export class JobUrlRejectedError extends Error {
  constructor(
    readonly reason: 'invalid' | 'domain',
    message: string,
  ) {
    super(message);
    this.name = 'JobUrlRejectedError';
  }
}

export class JobEnqueueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JobEnqueueError';
  }
}
