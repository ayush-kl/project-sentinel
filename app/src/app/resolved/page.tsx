import { CheckCircle2 } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { SeverityBadge } from "@/components/severity-badge";
import { ServiceOffline } from "@/components/service-offline";
import { getClaudeResolved } from "@/lib/sentinel";

export const dynamic = "force-dynamic";

export default async function ResolvedByClaudePage() {
  const incidents = await getClaudeResolved();

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Resolved by Claude
          </h1>
          <p className="text-sm text-muted-foreground">
            Incidents closed via the Resolution Protocol.
          </p>
        </div>
        {incidents && (
          <Badge variant="success">{incidents.length} resolved</Badge>
        )}
      </header>

      {incidents === null ? (
        <ServiceOffline service="incident-recorder" />
      ) : incidents.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-400" />
            <p className="font-medium">Nothing resolved by Claude yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Incidents appear here once a recovery line attributed to Claude is
              recorded (detail contains &ldquo;Claude&rdquo;).
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Resolution history</CardTitle>
            <CardDescription>
              Each row pairs the original failure with Claude&rsquo;s fix.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Original failure</TableHead>
                  <TableHead>Resolved</TableHead>
                  <TableHead>Resolution</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {incidents.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-medium">{i.service}</TableCell>
                    <TableCell>
                      <SeverityBadge severity={i.severity} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {i.detail}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {i.resolvedAt
                        ? new Date(i.resolvedAt).toLocaleString()
                        : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {i.resolution ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
