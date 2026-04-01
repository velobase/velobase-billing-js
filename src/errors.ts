export class VelobaseError extends Error {
  status: number;
  type: string;

  constructor(message: string, status: number, type: string) {
    super(message);
    this.name = "VelobaseError";
    this.status = status;
    this.type = type;
  }
}

export class VelobaseAuthenticationError extends VelobaseError {
  constructor(message: string) {
    super(message, 401, "auth_error");
    this.name = "VelobaseAuthenticationError";
  }
}

export class VelobaseValidationError extends VelobaseError {
  constructor(message: string) {
    super(message, 400, "validation_error");
    this.name = "VelobaseValidationError";
  }
}

export class VelobaseNotFoundError extends VelobaseError {
  constructor(message: string) {
    super(message, 404, "not_found");
    this.name = "VelobaseNotFoundError";
  }
}

export class VelobaseConflictError extends VelobaseError {
  constructor(message: string) {
    super(message, 409, "conflict");
    this.name = "VelobaseConflictError";
  }
}

export class VelobaseInternalError extends VelobaseError {
  constructor(message: string) {
    super(message, 500, "server_error");
    this.name = "VelobaseInternalError";
  }
}
