import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { ExecutorSnapshot } from "@/app/settings/page"

export function ExecutorStatus({ snapshot }: { snapshot: ExecutorSnapshot }) {
  if (!snapshot.reachable) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Executor unreachable</AlertTitle>
        <AlertDescription>
          <p>{snapshot.error}</p>
          <p className="mt-2">
            Start it with{" "}
            <code className="font-mono text-xs">uv run mobilerun-executor</code>{" "}
            in the api folder and check EXECUTOR_URL and EXECUTOR_TOKEN.
          </p>
        </AlertDescription>
      </Alert>
    )
  }

  const { health, config } = snapshot
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Executor <Badge variant="secondary">{health.status}</Badge>
          </CardTitle>
          <CardDescription>
            The Python service that drives phones with the mobilerun agent.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-sm">
          <span className="text-muted-foreground">Service version</span>
          <span className="font-mono">{health.version}</span>
          <span className="text-muted-foreground">mobilerun version</span>
          <span className="font-mono">{health.mobilerunVersion}</span>
          <span className="text-muted-foreground">Config file</span>
          <span className="truncate font-mono" title={config.configPath ?? ""}>
            {config.configPath ?? "default"}
          </span>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Models</CardTitle>
          <CardDescription>
            Read from the framework config. Edit the config file to change
            providers or keys.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Role</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Model</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {config.profiles.map((p) => (
                <TableRow key={p.role}>
                  <TableCell className="font-mono text-xs">{p.role}</TableCell>
                  <TableCell>{p.provider}</TableCell>
                  <TableCell className="font-mono text-xs">{p.model}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  )
}
