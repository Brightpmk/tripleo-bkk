export class OrderAdminError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "OrderAdminError";
    this.status = status;
  }
}
