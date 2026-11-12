export class SessionNotReadyError extends Error {
  constructor(message = 'La sesión no está lista (radiografía en curso o fallida)') {
    super(message);
    this.name = 'SessionNotReadyError';
  }
}

export class SessionCredentialsUnavailableError extends Error {
  constructor(message = 'CREDENTIALS_KEY no configurada: no se pueden guardar credenciales') {
    super(message);
    this.name = 'SessionCredentialsUnavailableError';
  }
}
