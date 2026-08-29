import { AuditSeverity } from "@/types/audit";

interface SeverityBadgeProps {
  severity: AuditSeverity;
}

export function SeverityBadge({ severity }: SeverityBadgeProps) {
  switch (severity) {
    case "blocker":
      return (
        <span className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-red-400">
          <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
          BLOCKER
        </span>
      );
    case "warning":
      return (
        <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-amber-400">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          WARNING
        </span>
      );
    case "nitpick":
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-blue-300">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
          NITPICK
        </span>
      );
  }
}
