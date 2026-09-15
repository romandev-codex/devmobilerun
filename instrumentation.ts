export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startAgenda } = await import("@/lib/jobs/agenda")
    try {
      await startAgenda()
      console.log("[agenda] job processing started")
    } catch (err) {
      console.error("[agenda] failed to start", err)
    }
  }
}
