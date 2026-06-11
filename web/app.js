import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BarcodeDetector } from "https://esm.sh/barcode-detector@3/ponyfill";

const { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY } = window.PANTRY_CONFIG;

// Light auth: RLS on the server checks this header against a passphrase
// stored in the database. Asked once per device, kept in localStorage.
let pantryKey = localStorage.getItem("pantryKey") ?? prompt("Pantry passphrase:") ?? "";
localStorage.setItem("pantryKey", pantryKey);
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { headers: { "x-pantry-key": pantryKey } },
});

db.rpc("pantry_key_valid").then(({ data }) => {
  if (data !== true) {
    localStorage.removeItem("pantryKey");
    const retry = prompt("Wrong passphrase — try again:");
    if (retry !== null) {
      localStorage.setItem("pantryKey", retry);
      location.reload();
    }
  }
});

const $ = (id) => document.getElementById(id);

// ---------- tabs ----------
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    document.querySelectorAll(".view").forEach((v) =>
      v.classList.toggle("active", v.id === tab.dataset.view)
    );
    if (tab.dataset.view === "pantry-view") loadPantry();
  });
});

// ---------- scanning ----------
const video = $("video");
const detector = new BarcodeDetector({
  formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"],
});

let scanning = false;
let audioCtx = null;
// barcode -> { rowId, lastSeen } for this session, so re-scanning the same
// product bumps quantity instead of creating duplicate rows.
const session = new Map();
const COOLDOWN_MS = 3500;

$("start-btn").addEventListener("click", startCamera);

async function startCamera() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    video.srcObject = stream;
    await video.play();
    $("start-btn").hidden = true;
    scanning = true;
    scanLoop();
  } catch (err) {
    const msg = $("camera-error");
    msg.textContent = `Camera unavailable: ${err.message}`;
    msg.hidden = false;
  }
}

async function scanLoop() {
  while (scanning) {
    if (video.readyState >= 2 && !document.hidden) {
      try {
        const codes = await detector.detect(video);
        if (codes.length > 0) handleScan(codes[0].rawValue);
      } catch {
        // a bad frame is fine, just keep going
      }
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

function beep() {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain).connect(audioCtx.destination);
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.12);
}

function flashScreen() {
  const flash = $("flash");
  flash.classList.add("on");
  setTimeout(() => flash.classList.remove("on"), 180);
}

async function handleScan(barcode) {
  const now = Date.now();
  const seen = session.get(barcode);
  if (seen && now - seen.lastSeen < COOLDOWN_MS) return; // same code still in frame

  beep();
  flashScreen();
  if (navigator.vibrate) navigator.vibrate(60);

  if (seen) {
    // scanned this product again on purpose -> +1 quantity
    seen.lastSeen = now;
    seen.quantity += 1;
    updateSessionRow(seen);
    await db.from("pantry_items").update({ quantity: seen.quantity }).eq("id", seen.rowId);
    return;
  }

  const entry = {
    barcode,
    rowId: null,
    lastSeen: now,
    quantity: 1,
    name: null,
    image: null,
    el: addSessionRow(barcode),
  };
  session.set(barcode, entry);

  const product = await lookupProduct(barcode);
  entry.name = product?.name ?? null;
  entry.image = product?.image ?? null;

  const { data, error } = await db
    .from("pantry_items")
    .insert({
      barcode,
      name: product?.name ?? null,
      brand: product?.brand ?? null,
      category: product?.category ?? null,
      unit: product?.unit ?? null,
      image_url: product?.image ?? null,
      raw: product?.raw ?? null,
      source: "scan",
    })
    .select("id")
    .single();

  if (error) {
    entry.el.querySelector(".item-name").textContent = `⚠ save failed: ${error.message}`;
    return;
  }
  entry.rowId = data.id;
  updateSessionRow(entry);
}

async function lookupProduct(barcode) {
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${barcode}.json` +
        `?fields=product_name,brands,categories_tags,image_small_url,quantity`
    );
    const json = await res.json();
    if (json.status !== 1) return null;
    const p = json.product;
    return {
      name: p.product_name || null,
      brand: p.brands || null,
      category: p.categories_tags?.at(-1)?.replace(/^en:/, "").replaceAll("-", " ") || null,
      unit: p.quantity || null,
      image: p.image_small_url || null,
      raw: p,
    };
  } catch {
    return null; // offline or OFF down — store the barcode, name it later
  }
}

// ---------- session list UI ----------
function addSessionRow(barcode) {
  const li = document.createElement("li");
  li.innerHTML = `
    <img class="item-img" hidden>
    <span class="item-name">Looking up ${barcode}…</span>
    <span class="item-qty"></span>`;
  li.addEventListener("click", () => renameItem(session.get(barcode)));
  $("session-list").prepend(li);
  bumpSessionCount();
  return li;
}

function updateSessionRow(entry) {
  const img = entry.el.querySelector(".item-img");
  if (entry.image) {
    img.src = entry.image;
    img.hidden = false;
  }
  entry.el.querySelector(".item-name").textContent =
    entry.name ?? `Unknown (${entry.barcode}) — tap to name`;
  entry.el.querySelector(".item-qty").textContent = entry.quantity > 1 ? `×${entry.quantity}` : "";
}

function bumpSessionCount() {
  $("session-count").textContent = `This session · ${session.size + manualCount} item${
    session.size + manualCount === 1 ? "" : "s"
  }`;
}

async function renameItem(entry) {
  if (!entry?.rowId) return;
  const name = prompt("Item name:", entry.name ?? "");
  if (!name) return;
  entry.name = name;
  updateSessionRow(entry);
  await db.from("pantry_items").update({ name, source: "scan" }).eq("id", entry.rowId);
}

// ---------- manual add (produce etc.) ----------
let manualCount = 0;
$("manual-add-btn").addEventListener("click", async () => {
  const name = prompt("Item name (e.g. bananas):");
  if (!name) return;
  const qty = parseFloat(prompt("Quantity:", "1") || "1") || 1;
  const { error } = await db
    .from("pantry_items")
    .insert({ name, quantity: qty, source: "manual" });
  const li = document.createElement("li");
  li.innerHTML = `<span class="item-name"></span><span class="item-qty"></span>`;
  li.querySelector(".item-name").textContent = error ? `⚠ save failed: ${name}` : name;
  li.querySelector(".item-qty").textContent = qty > 1 ? `×${qty}` : "";
  $("session-list").prepend(li);
  manualCount++;
  bumpSessionCount();
});

// ---------- pantry view ----------
async function loadPantry() {
  const { data, error } = await db
    .from("pantry_items")
    .select("id,name,barcode,brand,quantity,image_url,added_at")
    .is("consumed_at", null)
    .order("added_at", { ascending: false });

  const list = $("pantry-list");
  list.innerHTML = "";
  if (error) {
    $("pantry-count").textContent = "⚠ " + error.message;
    return;
  }
  $("pantry-count").textContent = `${data.length} item${data.length === 1 ? "" : "s"}`;
  $("pantry-empty").hidden = data.length > 0;

  for (const item of data) {
    const li = document.createElement("li");
    li.innerHTML = `
      <img class="item-img" hidden>
      <div class="item-meta">
        <span class="item-name"></span>
        <span class="item-sub"></span>
      </div>
      <span class="item-qty"></span>
      <button class="consume-btn" title="Used up">✓</button>`;
    const img = li.querySelector(".item-img");
    if (item.image_url) {
      img.src = item.image_url;
      img.hidden = false;
    }
    li.querySelector(".item-name").textContent =
      item.name ?? `Unknown (${item.barcode ?? "no barcode"})`;
    li.querySelector(".item-sub").textContent = [
      item.brand,
      new Date(item.added_at).toLocaleDateString(),
    ]
      .filter(Boolean)
      .join(" · ");
    li.querySelector(".item-qty").textContent = item.quantity > 1 ? `×${item.quantity}` : "";
    li.querySelector(".consume-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      li.remove();
      await db
        .from("pantry_items")
        .update({ consumed_at: new Date().toISOString() })
        .eq("id", item.id);
    });
    li.addEventListener("click", async () => {
      const name = prompt("Item name:", item.name ?? "");
      if (!name) return;
      li.querySelector(".item-name").textContent = name;
      await db.from("pantry_items").update({ name }).eq("id", item.id);
    });
    list.appendChild(li);
  }
}
