import { Activity, AlertTriangle, CheckCircle2, Wrench } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  getSystemStatus,
  type SystemStatusValue,
} from "@/lib/sentinel";

const CONFIG: Record<
  SystemStatusValue,
  {
    label: string;
    variant: "success" | "info" | "warning" | "secondary";
    icon: typeof Activity;
  }
> = {
  operational: { label: "Operational", variant: "success", icon: CheckCircle2 },
  investigating: { label: "Investigating", variant: "info", icon: Activity },
  degraded: { label: "Degraded", variant: "warning", icon: AlertTriangle },
  maintenance: { label: "Maintenance", variant: "secondary", icon: Wrench },
};

export async function StatusBanner() {
  const status = await getSystemStatus();
  if (!status) return null;

  const { label, variant, icon: Icon } = CONFIG[status.status];

  return (
    <div className="flex items-center gap-3 border-b bg-card px-8 py-3">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className="text-sm font-medium">Dashboard status</span>
      <Badge variant={variant}>{label}</Badge>
      {status.note && (
        <span className="truncate text-sm text-muted-foreground">
          {status.note}
        </span>
      )}
      {status.updatedAt && (
        <span className="ml-auto text-xs text-muted-foreground">
          updated {new Date(status.updatedAt).toLocaleString()}
        </span>
      )}
    </div>
  );
}
