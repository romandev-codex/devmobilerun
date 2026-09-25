export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { migrateAppCardsFromSettings } = await import("@/lib/app-cards")
      const moved = await migrateAppCardsFromSettings()
      if (moved > 0)
        console.log(`[app-cards] moved ${moved} card(s) out of settings`)
    } catch (err) {
      console.error("[app-cards] migration from settings failed", err)
    }
    try {
      const { migrateRunInputs } = await import("@/lib/runs/inputs")
      const moved = await migrateRunInputs()
      if (moved > 0)
        console.log(`[runs] moved ${moved} run(s) to shared prompt/card texts`)
    } catch (err) {
      console.error("[runs] prompt/card snapshot migration failed", err)
    }
    const { startAgenda } = await import("@/lib/jobs/agenda")
    try {
      await startAgenda()
      console.log("[agenda] job processing started")
    } catch (err) {
      console.error("[agenda] failed to start", err)
    }
  }
}
