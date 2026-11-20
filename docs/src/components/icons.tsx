import type { LucideIcon } from "lucide-react";
import {
	Activity,
	AlertTriangle,
	ArrowLeftRight,
	BarChart3,
	Bell,
	Bot,
	BookOpen,
	Braces,
	Building,
	Cable,
	CheckCircle,
	Cloud,
	CircleAlert,
	Clock,
	Code,
	Code2,
	Cpu,
	Database,
	Download,
	FileCode,
	FileText,
	Flag,
	FlaskConical,
	Gauge,
	GitBranch,
	GitPullRequest,
	HardDrive,
	HelpCircle,
	KeyRound,
	Layers,
	Layout,
	LayoutDashboard,
	List,
	ListTree,
	Network,
	Package,
	Play,
	Plug,
	Repeat2,
	Rocket,
	Route,
	Search,
	Server,
	ShieldCheck,
	Ship,
	Sliders,
	Settings2,
	Terminal,
	TestTube,
	TriangleAlert,
	Workflow,
	Wrench,
} from "lucide-react";
import type { ComponentProps } from "react";

/** Icons used by page frontmatter and the small amount of shared chrome. */
export type IconType = LucideIcon;

/**
 * Frontmatter can name an icon but cannot contain a component. Keeping this
 * map here makes the supported set explicit and keeps icon imports in one
 * place.
 */
export const OSS_ICONS = {
	Activity,
	AlertTriangle,
	ArrowLeftRight,
	BarChart3,
	Bell,
	Bot,
	BookOpen,
	Braces,
	Building,
	Cable,
	CheckCircle,
	Cloud,
	CircleAlert,
	Clock,
	Code,
	Code2,
	Cpu,
	Database,
	Download,
	FileCode,
	FileText,
	Flag,
	FlaskConical,
	Gauge,
	GitBranch,
	GitPullRequest,
	HardDrive,
	HelpCircle,
	KeyRound,
	Layers,
	Layout,
	LayoutDashboard,
	List,
	ListTree,
	Network,
	Package,
	Play,
	Plug,
	Repeat2,
	Rocket,
	Route,
	Search,
	Server,
	ShieldCheck,
	Ship,
	Sliders,
	Settings2,
	Terminal,
	TestTube,
	TriangleAlert,
	Workflow,
	Wrench,
	FileTypePython: Code,
	FileTypeRust: FileCode,
} as const satisfies Record<string, LucideIcon>;

export type OssIconName = keyof typeof OSS_ICONS;

const DEFAULT_OSS_ICON: LucideIcon = FileText;

export const ossIcon = (name?: string): LucideIcon =>
	(name && OSS_ICONS[name as OssIconName]) || DEFAULT_OSS_ICON;

/** The original Incremental wordmark, with light and dark theme support. */
type WordmarkProps = Omit<ComponentProps<"img">, "src">;

const Wordmark = ({
	alt = "Incremental",
	className,
	...props
}: WordmarkProps) => (
	<img
		alt={alt}
		className={className ? `${className} dark:invert` : "dark:invert"}
		src="/wordmark.svg"
		{...props}
	/>
);

export const Icons = { Wordmark } as const;
