import { WifiOff } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

export function ServiceOffline({ service }: { service: string }) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
        <WifiOff className="h-5 w-5 text-destructive" />
        <span>
          <span className="font-medium text-foreground">{service}</span> is
          unreachable. Start it with{" "}
          <code className="rounded bg-muted px-1 py-0.5">
            npm run dev:services
          </code>
          .
        </span>
      </CardContent>
    </Card>
  );
}
