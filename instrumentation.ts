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
    const { startAgenda } = await import("@/lib/jobs/agenda")
    try {
      await startAgenda()
      console.log("[agenda] job processing started")
    } catch (err) {
      console.error("[agenda] failed to start", err)
    }
  }
}
