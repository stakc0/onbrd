import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const COPYCAT_MINT = Deno.env.get("COPYCAT_MINT") || "CA_PENDING";
const MIN_SOL_TRIGGER = Number(Deno.env.get("COPYCAT_MIN_SOL_TRIGGER") || "1");
const WEBHOOK_SECRET = Deno.env.get("COPYCAT_WEBHOOK_SECRET") || "";
const ADMIN_SECRET = Deno.env.get("COPYCAT_ADMIN_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function extractEvents(payload: unknown): any[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") return [payload];
  return [];
}

function solFromLamports(n: unknown): number {
  return Math.abs(Number(n || 0)) / 1_000_000_000;
}

function tokenBoughtForMint(event: any): boolean {
  const changes = event?.tokenTransfers ?? event?.tokenBalanceChanges ?? event?.accountData?.flatMap((a: any) => a?.tokenBalanceChanges ?? []) ?? [];
  if (!Array.isArray(changes)) return false;
  return changes.some((change: any) => change?.mint === COPYCAT_MINT && Number(change?.tokenAmount ?? change?.rawTokenAmount?.tokenAmount ?? 0) > 0);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (WEBHOOK_SECRET) {
    const provided = req.headers.get("x-copycat-secret") || req.headers.get("authorization") || "";
    if (provided !== WEBHOOK_SECRET && provided !== `Bearer ${WEBHOOK_SECRET}`) return json({ error: "unauthorized" }, 401);
  }
  const body = await req.json().catch(() => null);
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const events = extractEvents(body);
  const rows: any[] = [];

  for (const event of events) {
    const signature = event?.signature;
    if (!signature) continue;
    const accountData = Array.isArray(event?.accountData) ? event.accountData : [];
    const payer = accountData.find((a: any) => Number(a?.nativeBalanceChange ?? 0) < 0);
    const buyerWallet = payer?.account ?? event?.feePayer ?? null;
    const solSpent = solFromLamports(payer?.nativeBalanceChange);
    const isBuy = COPYCAT_MINT === "CA_PENDING" ? solSpent >= MIN_SOL_TRIGGER : tokenBoughtForMint(event) && solSpent >= MIN_SOL_TRIGGER;

    rows.push({
      trigger_signature: signature,
      buyer_wallet: buyerWallet,
      sol_amount: solSpent,
      status: isBuy ? "queued" : "ignored",
    });
  }

  const queued = rows.filter((row) => row.status === "queued").length;
  if (rows.length) {
    const { error } = await supabase.from("copycat_launches").upsert(rows, { onConflict: "trigger_signature", ignoreDuplicates: true });
    if (error) return json({ error: error.message }, 500);
  }

  if (queued > 0 && ADMIN_SECRET) {
    const launchPromise = fetch(`${SUPABASE_URL}/functions/v1/process-copycat-launch`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: SERVICE_ROLE,
        authorization: `Bearer ${SERVICE_ROLE}`,
        "x-copycat-admin-secret": ADMIN_SECRET,
      },
    }).catch((error) => console.error("instant launch trigger failed", error));
    // Keep webhook response fast while letting Supabase continue the launch request.
    // deno-lint-ignore no-explicit-any
    const edgeRuntime = (globalThis as any).EdgeRuntime;
    if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(launchPromise);
  }

  return json({ ok: true, received: events.length, inserted: rows.length, queued, instantLaunch: queued > 0 && !!ADMIN_SECRET });
});
