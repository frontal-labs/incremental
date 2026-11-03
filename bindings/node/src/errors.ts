export class BackplaneError extends Error {
  code: string;
  data?: unknown;
  constructor(code: string, message: string, data?: unknown){ super(message); this.code=code; this.data=data; }
}
