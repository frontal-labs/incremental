import type { ComponentProps } from "react";

import { Link as NavLink } from "@/components/navigation";

type LinkProps = ComponentProps<typeof NavLink>;

/** Shared locale-aware link used throughout the app. */
export function Link(props: LinkProps) {
	return <NavLink {...props} />;
}
