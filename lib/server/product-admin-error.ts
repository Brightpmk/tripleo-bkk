export class ProductAdminError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly fieldErrors: Record<string, string> = {}
  ) {
    super(message);
    this.name = "ProductAdminError";
  }
}
