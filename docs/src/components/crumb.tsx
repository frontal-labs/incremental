import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/breadcrumb";
import { Link } from "@/components/navigation";

export interface CrumbProps {
  /** The developer reference root this trail starts at. */
  href: string;
  /** The surface root's own label, translated by the caller. */
  root: string;
  /** The sidebar section holding this page. */
  section: string;
}

/**
 * Where in the sidebar the current page lives, above its title.
 *
 * Only pages inside a collapsible section get one: a page that is a row of its
 * own has no section to name, and a trail of one entry says nothing the header
 * does not already say. The page's own title is left out for the same reason,
 * since the heading underneath repeats it a line later.
 */
export function Crumb({ href, root, section }: CrumbProps) {
  return (
    <Breadcrumb>
      <BreadcrumbList className="font-sans">
        <BreadcrumbItem>
          <Link className="transition-colors hover:text-foreground" href={href}>
            {root}
          </Link>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{section}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
