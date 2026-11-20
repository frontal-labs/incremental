const DEFAULT_MESSAGE = "An error occurred";

const toMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }

  return error === undefined ? DEFAULT_MESSAGE : String(error);
};

/** Normalizes an unknown throwable into a user-facing message. */
export const parseError = (error: unknown): string => toMessage(error);
