import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import bs58 from "npm:bs58@6.0.0";
import { Connection, Keypair, VersionedTransaction } from "npm:@solana/web3.js@1.98.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_SECRET = Deno.env.get("COPYCAT_ADMIN_SECRET") || "";
const LAUNCH_PRIVATE_KEY = Deno.env.get("COPYCAT_LAUNCH_PRIVATE_KEY")!;
const IMAGE_URL = Deno.env.get("COPYCAT_IMAGE_URL") || "https://raw.githubusercontent.com/stakc0/copycat/main/public/token/copycat-token.jpg";
const WEBSITE = Deno.env.get("COPYCAT_WEBSITE") || "https://copy-cat.lol";
const TWITTER = Deno.env.get("COPYCAT_TWITTER") || "https://x.com/catalyst100x";
const TELEGRAM = Deno.env.get("COPYCAT_TELEGRAM") || "";
const DEV_BUY_SOL = Number(Deno.env.get("COPYCAT_DEV_BUY_SOL") || "0");
const HELIUS_RPC_URL = Deno.env.get("HELIUS_RPC_URL") || "https://api.mainnet-beta.solana.com";
const MAX_PER_RUN = Number(Deno.env.get("COPYCAT_MAX_PER_RUN") || "1");
const MAX_LAUNCHES = Number(Deno.env.get("COPYCAT_MAX_LAUNCHES") || "100");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function fetchImageBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`image fetch failed ${res.status}`);
  return await res.blob();
}

async function uploadMetadata(name: string, symbol: string, description: string) {
  const form = new FormData();
  form.set("name", name);
  form.set("symbol", symbol);
  form.set("description", description);
  if (TWITTER) form.set("twitter", TWITTER);
  if (TELEGRAM) form.set("telegram", TELEGRAM);
  if (WEBSITE) form.set("website", WEBSITE);
  form.set("showName", "true");
  const blob = await fetchImageBlob(IMAGE_URL);
  form.set("file", blob, "copycat.png");
  const res = await fetch("https://pump.fun/api/ipfs", { method: "POST", body: form });
  if (!res.ok) throw new Error(`metadata upload failed ${res.status}: ${await res.text()}`);
  const out = await res.json();
  if (!out?.metadataUri) throw new Error("missing metadataUri");
  return out.metadataUri as string;
}

async function createPumpLaunch(index: number, payer: Keypair) {
  const mint = Keypair.generate();
  const name = "copycat";
  const symbol = "copycat";
  const description = `copycat launch #${index}. Every buy above 1 SOL copies the cat and triggers another launch.`;
  const uri = await uploadMetadata(name, symbol, description);

  const args = [{
    publicKey: payer.publicKey.toBase58(),
    action: "create",
    tokenMetadata: { name, symbol, uri },
    mint: mint.publicKey.toBase58(),
    denominatedInSol: "true",
    amount: DEV_BUY_SOL,
    slippage: 20,
    priorityFee: 0.0005,
    pool: "pump",
  }];

  const localRes = await fetch("https://pumpportal.fun/api/trade-local", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!localRes.ok) throw new Error(`trade-local failed ${localRes.status}: ${await localRes.text()}`);
  const encoded = await localRes.json();
  const raw = Array.isArray(encoded) ? encoded[0] : encoded;
  const tx = VersionedTransaction.deserialize(bs58.decode(raw));
  const signedTx = new VersionedTransaction(tx.message);
  signedTx.sign([mint, payer]);
  const signature = bs58.encode(signedTx.signatures[0]);
  const connection = new Connection(HELIUS_RPC_URL, "confirmed");
  const sent = await connection.sendRawTransaction(signedTx.serialize(), { skipPreflight: false, maxRetries: 5 });
  const confirmation = await connection.confirmTransaction(sent, "confirmed");
  if (confirmation.value.err) throw new Error(`send failed: ${JSON.stringify(confirmation.value.err)}`);
  return { mint: mint.publicKey.toBase58(), signature: sent || signature };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (ADMIN_SECRET && req.headers.get("x-copycat-admin-secret") !== ADMIN_SECRET) return json({ error: "unauthorized" }, 401);
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const payer = Keypair.fromSecretKey(bs58.decode(LAUNCH_PRIVATE_KEY));

  const { count } = await supabase.from("copycat_launches").select("id", { count: "exact", head: true }).eq("status", "launched");
  if ((count ?? 0) >= MAX_LAUNCHES) return json({ processed: 0, reason: "max launches reached" });

  const { data: queued, error } = await supabase.from("copycat_launches").select("*").eq("status", "queued").order("created_at", { ascending: true }).limit(MAX_PER_RUN);
  if (error) return json({ error: error.message }, 500);
  let launched = 0;
  const results: unknown[] = [];

  for (const row of queued ?? []) {
    const launchIndex = (count ?? 0) + launched + 1;
    await supabase.from("copycat_launches").update({ status: "processing", launch_index: launchIndex }).eq("id", row.id);
    try {
      const result = await createPumpLaunch(launchIndex, payer);
      await supabase.from("copycat_launches").update({ status: "launched", launched_mint: result.mint, launch_signature: result.signature, processed_at: new Date().toISOString(), error: null }).eq("id", row.id);
      launched += 1;
      results.push({ id: row.id, launchIndex, ...result });
    } catch (e) {
      await supabase.from("copycat_launches").update({ status: "failed", error: String(e?.message ?? e), processed_at: new Date().toISOString() }).eq("id", row.id);
      results.push({ id: row.id, error: String(e?.message ?? e) });
    }
  }

  return json({ processed: queued?.length ?? 0, launched, results });
});
