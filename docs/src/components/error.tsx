import { Button } from "@/components/button";
import { ArrowUpRight } from "lucide-react";

interface ErrorViewProps {
  action: {
    label: string;
    onClick?: () => void;
    href?: string;
  };
  description: string;
  title: string;
}

export const ErrorView = ({ title, description, action }: ErrorViewProps) => (
  <div className="relative overflow-visible lg:overflow-hidden">
    <div className="relative flex flex-col overflow-hidden">
      <div className="z-20 flex flex-1 flex-col justify-center lg:w-full lg:flex-none">
        <div className="page-shell flex h-screen flex-col items-center justify-center text-center">
          <div className="flex w-full 3xl:max-w-6xl max-w-4xl flex-col items-center space-y-6 px-2 lg:space-y-8 lg:px-0">
            <div className="space-y-5">
              <h1 className="font-sans text-foreground text-xl leading-[1.1] tracking-tight sm:text-xl md:text-2xl lg:text-3xl xl:text-4xl">
                {title}
              </h1>

              <p className="max-w-2xl font-sans text-base text-muted-foreground leading-relaxed lg:text-lg">
                {description}
              </p>
            </div>

            {action.href ? (
              <Button
                className="group inline-flex items-center gap-1"
                nativeButton={false}
                render={<a aria-label={action.label} href={action.href} />}
                shape="pill"
                size="lg"
              >
                <span className="text-inherit text-sm">{action.label}</span>
                <ArrowUpRight className="size-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </Button>
            ) : (
              <Button onClick={action.onClick} shape="pill" size="lg">
                <span className="text-inherit text-sm">{action.label}</span>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  </div>
);
