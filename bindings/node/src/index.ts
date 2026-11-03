// @backplane/client: the Node/TypeScript binding of backplane Protocol v1.
export { connect, defaultEngine, defaultStore, repoRoot, CLIENT_VERSION } from "./client.js";
export type { backplane } from "./client.js";
export { backplaneError, isBackplaneError } from "./errors.js";
export type { ErrorCode } from "./errors.js";
export type * from "./types.js";
