export class ScheduleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleValidationError';
  }
}
