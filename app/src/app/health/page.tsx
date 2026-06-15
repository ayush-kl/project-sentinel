import { CircleCheck, CircleX, Plug, PlugZap } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ServiceOffline } from "@/components/service-offline";
import { getMcpStatus, getSystemHealth } from "@/lib/sentinel";

export const dynamic = "force-dynamic";

export default async function SystemHealthPage() {
  const [health, mcp] = await Promise.all([getSystemHealth(), getMcpStatus()]);

  const downCount = health?.targets.filter((t) => !t.up).length ?? 0;
  const allUp = health !== null && downCount === 0;
  const mcpDown = mcp?.servers.filter((s) => !s.connected).length ?? 0;

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            System Health
          </h1>
          <p className="text-sm text-muted-foreground">
            Live status of every monitored target.
          </p>
        </div>
        {health && (
          <Badge variant={allUp ? "success" : "destructive"}>
            {allUp ? "All systems operational" : `${downCount} degraded`}
          </Badge>
        )}
      </header>

      {health === null ? (
        <ServiceOffline service="health-monitor" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {health.targets.map((t) => (
            <Card key={t.name}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-base">{t.name}</CardTitle>
                {t.up ? (
                  <CircleCheck className="h-5 w-5 text-emerald-400" />
                ) : (
                  <CircleX className="h-5 w-5 text-destructive" />
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                <Badge variant={t.up ? "success" : "destructive"}>
                  {t.up ? "UP" : "DOWN"}
                </Badge>
                <CardDescription>
                  Last checked{" "}
                  {t.lastChecked
                    ? new Date(t.lastChecked).toLocaleTimeString()
                    : "—"}
                </CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">MCP Servers</h2>
            <p className="text-sm text-muted-foreground">
              Connectivity of configured Model Context Protocol servers.
            </p>
          </div>
          {mcp && mcp.available && (
            <Badge variant={mcpDown === 0 ? "success" : "destructive"}>
              {mcpDown === 0
                ? `${mcp.servers.length} connected`
                : `${mcpDown} disconnected`}
            </Badge>
          )}
        </div>

        {mcp === null ? (
          <ServiceOffline service="health-monitor" />
        ) : !mcp.enabled ? (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">
              MCP monitoring is disabled (set <code>MCP_MONITOR</code> to enable).
            </CardContent>
          </Card>
        ) : !mcp.available ? (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">
              MCP status unavailable — the <code>claude</code> CLI could not be
              reached from health-monitor.
            </CardContent>
          </Card>
        ) : mcp.servers.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">
              No MCP servers configured.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {mcp.servers.map((s) => (
              <Card key={s.name}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-base">{s.name}</CardTitle>
                  {s.connected ? (
                    <Plug className="h-5 w-5 text-emerald-400" />
                  ) : (
                    <PlugZap className="h-5 w-5 text-destructive" />
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  <Badge variant={s.connected ? "success" : "destructive"}>
                    {s.connected ? "Connected" : "Disconnected"}
                  </Badge>
                  <CardDescription className="truncate" title={s.command}>
                    {s.command}
                  </CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
