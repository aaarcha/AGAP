// The one shared password policy lives in shared/password.js.
// This module only re-exports it so the client and the server can never drift.
export * from "../../shared/password.js";
