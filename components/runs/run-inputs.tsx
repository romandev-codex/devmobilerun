import type { TaskOptions } from "@/lib/agents"
import { promptRolesUsedBy } from "@/lib/prompt-roles"
import type { RunInputs } from "@/lib/runs/inputs"

const pre = "max-h-48 overflow-auto rounded bg-muted p-2 whitespace-pre-wrap"

function TextBlock({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <p className="font-mono">{title}</p>
      <pre className={pre}>{text}</pre>
    </div>
  )
}

/**
 * The global prompt overrides and app cards a run started with, narrowed to
 * what its agent actually read: prompts for roles its mode uses, and the cards
 * the executor reported as reaching the model.
 */
export function RunInputsDetails({
  inputs,
  options,
  running,
}: {
  inputs: RunInputs
  options: TaskOptions
  running: boolean
}) {
  const roles = promptRolesUsedBy(options)
  const prompts = Object.entries(inputs.prompts)
  const readPrompts = prompts.filter(([role]) =>
    (roles as readonly string[]).includes(role)
  )
  const ignoredRoles = prompts
    .filter(([role]) => !(roles as readonly string[]).includes(role))
    .map(([role]) => role)
  const tracked = inputs.appCards.every((c) => c.used !== null)
  const usedCards = inputs.appCards.filter((c) => c.used !== false)
  const unusedCards = inputs.appCards.filter((c) => c.used === false)
  if (prompts.length === 0 && inputs.appCards.length === 0) return null

  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">
        Prompt overrides and app cards
      </summary>
      <div className="mt-2 grid gap-3 text-xs">
        {prompts.length > 0 ? (
          <section className="grid gap-2">
            <p className="font-medium">Prompt overrides</p>
            {readPrompts.map(([role, text]) => (
              <TextBlock key={role} title={role} text={text} />
            ))}
            {ignoredRoles.length > 0 ? (
              <p className="text-muted-foreground">
                {options.agent === "jev"
                  ? "Jev uses its own prompts; not read: "
                  : `Not read in ${options.reasoning ? "reasoning" : "direct"} mode: `}
                <span className="font-mono">{ignoredRoles.join(", ")}</span>
              </p>
            ) : null}
          </section>
        ) : null}
        {inputs.appCards.length > 0 ? (
          <section className="grid gap-2">
            <p className="font-medium">
              {tracked
                ? `App cards used${running ? " so far" : ""}`
                : "App cards sent"}
            </p>
            {!tracked ? (
              <p className="text-muted-foreground">
                This run predates usage tracking: every card was sent, but which
                ones reached the model is unknown.
              </p>
            ) : usedCards.length === 0 ? (
              <p className="text-muted-foreground">
                {options.reasoning || options.agent === "jev"
                  ? "None: the agent never opened an app that has a card."
                  : "None: the task names no app that has a card."}
              </p>
            ) : null}
            {usedCards.map((c) => (
              <TextBlock
                key={c.packageName}
                title={c.name ? `${c.packageName} (${c.name})` : c.packageName}
                text={c.content}
              />
            ))}
            {unusedCards.length > 0 ? (
              <p className="text-muted-foreground">
                Sent but not used ({unusedCards.length}):{" "}
                <span className="font-mono">
                  {unusedCards.map((c) => c.packageName).join(", ")}
                </span>
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
    </details>
  )
}
