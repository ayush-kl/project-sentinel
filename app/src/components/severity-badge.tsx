import { Badge } from "@/components/ui/badge";
import type { Severity } from "@/lib/sentinel";

const VARIANT: Record<Severity, "destructive" | "warning" | "success"> = {
  CRITICAL: "destructive",
  WARN: "warning",
  INFO: "success",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Badge variant={VARIANT[severity]}>{severity}</Badge>;
}
