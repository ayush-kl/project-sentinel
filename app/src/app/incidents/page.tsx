import { AlertTriangle } from "lucide-react";

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
import { getActiveIncidents } from "@/lib/sentinel";

export const dynamic = "force-dynamic";

export default async function ActiveIncidentsPage() {
  const incidents = await getActiveIncidents();

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Active Incidents
          </h1>
          <p className="text-sm text-muted-foreground">
            Open failures detected by health-monitor, awaiting resolution.
          </p>
        </div>
        {incidents && (
          <Badge variant={incidents.length ? "destructive" : "success"}>
            {incidents.length} open
          </Badge>
        )}
      </header>

      {incidents === null ? (
        <ServiceOffline service="incident-recorder" />
      ) : incidents.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <AlertTriangle className="h-8 w-8 text-emerald-400" />
            <p className="font-medium">No active incidents</p>
            <p className="text-sm text-muted-foreground">
              All monitored services are healthy.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Open incidents</CardTitle>
            <CardDescription>
              Ordered newest first. Resolve via the Resolution Protocol.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Detected</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {incidents.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {new Date(i.time).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-medium">{i.service}</TableCell>
                    <TableCell>
                      <SeverityBadge severity={i.severity} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {i.detail}
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
