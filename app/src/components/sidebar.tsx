"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, AlertTriangle, CheckCircle2, Shield } from "lucide-react";

import { cn } from "@/lib/utils";

const NAV = [
  { href: "/incidents", label: "Active Incidents", icon: AlertTriangle },
  { href: "/resolved", label: "Resolved by Claude", icon: CheckCircle2 },
  { href: "/health", label: "System Health", icon: Activity },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-card">
      <div className="flex items-center gap-2 border-b px-6 py-5">
        <Shield className="h-6 w-6 text-primary" />
        <div>
          <p className="text-sm font-semibold leading-tight">Project Sentinel</p>
          <p className="text-xs text-muted-foreground">Resilience dashboard</p>
        </div>
      </div>
      <nav className="flex flex-col gap-1 p-3">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
