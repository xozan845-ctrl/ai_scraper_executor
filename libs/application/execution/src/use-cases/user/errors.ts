export class UserAlreadyExistsError extends Error {
  constructor(message = 'Ya existe un usuario; el registro inicial está cerrado.') {
    super(message);
    this.name = 'UserAlreadyExistsError';
  }
}
