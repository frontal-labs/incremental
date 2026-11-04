export class BazelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BazelError";
  }
}
