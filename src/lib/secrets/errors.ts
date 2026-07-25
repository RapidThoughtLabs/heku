export class NotWritableError extends Error {
  constructor(providerId: string) {
    super(`master-key provider "${providerId}" is read-only`);
    this.name = "NotWritableError";
  }
}
