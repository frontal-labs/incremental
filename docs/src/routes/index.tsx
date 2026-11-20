import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Keep the documented root URL useful while preserving locale-prefixed routes.
 */
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ href: "/en/" });
  },
});
