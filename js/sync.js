// Your data (👍/👎, watch rules, learning progress) lives in data/me.json in the repo, so the
// daily run can use it. The app writes it through the GitHub API with a token you paste once;
// the token stays in this browser only. Without a token everything still works on this device.
const REPO = "Masmae/paperoftheday";
const PATH = "data/me.json";
const API = `https://api.github.com/repos/${REPO}/contents/${PATH}`;
const LS = "potd.";

const local = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(LS + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem(LS + k); } catch { /* ignore */ } },
};

export const EMPTY = { version: 1, votes: {}, watch: null, learn: {} };
let me = local.get("me", null);
let status = { state: "local", message: "" };       // local | synced | saving | error
const listeners = new Set();
const emit = () => listeners.forEach((f) => f(me, status));
export const onChange = (f) => { listeners.add(f); return () => listeners.delete(f); };

export const getToken = () => local.get("ghToken", "");
export const getMe = () => me ?? structuredClone(EMPTY);
export const getStatus = () => status;

const b64encode = (str) => { const bytes = new TextEncoder().encode(str); let bin = ""; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin); };
const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));
const headers = (token) => ({ Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" });

async function fetchRemote(token) {
  const res = await fetch(`${API}?ref=main&t=${Date.now()}`, { headers: headers(token), cache: "no-store" });
  if (res.status === 404) return { data: structuredClone(EMPTY), sha: null };
  if (!res.ok) throw new Error(res.status === 401 ? "token rejected" : `GitHub ${res.status}`);
  const j = await res.json();
  return { data: { ...EMPTY, ...JSON.parse(b64decode(j.content)) }, sha: j.sha };
}

/** Union of two copies: newest vote per paper wins; the other fields prefer `a`. */
function merge(a, b) {
  const votes = { ...b.votes };
  for (const [k, v] of Object.entries(a.votes ?? {})) if (!votes[k] || (v.at ?? "") >= (votes[k].at ?? "")) votes[k] = v;
  const learn = { ...b.learn };
  for (const [t, v] of Object.entries(a.learn ?? {})) learn[t] = { ...learn[t], ...v, done: [...new Set([...(learn[t]?.done ?? []), ...(v.done ?? [])])] };
  return { ...b, ...a, votes, learn, watch: a.watch ?? b.watch };
}

/** Load: the repo copy (fresh via the API with a token, else the published file), merged with this device's copy. */
export async function load() {
  const token = getToken();
  try {
    if (token) {
      const { data } = await fetchRemote(token);
      me = me ? { ...merge(me, data), watch: data.watch ?? me.watch } : data;   // rules: the repo copy is newest
      status = { state: "synced", message: "" };
    } else {
      const r = await fetch(`${PATH}?t=${Date.now()}`, { cache: "no-store" });
      const data = r.ok ? { ...EMPTY, ...(await r.json()) } : structuredClone(EMPTY);
      me = me ? { ...merge(me, data), watch: data.watch ?? me.watch } : data;   // rules: the repo copy is newest
      status = { state: "local", message: "" };
    }
  } catch (e) {
    me = me ?? structuredClone(EMPTY);
    status = { state: "error", message: e.message };
  }
  local.set("me", me);
  emit();
  return me;
}

let queue = Promise.resolve();
/**
 * Change your data: `mutate(copy)` edits a copy in place. Applied locally at once, then
 * committed to the repo (re-applied on top of the latest remote copy if it changed meanwhile).
 * `mutate` may run more than once, so it must set values (not toggle them). An undone vote is
 * stored as { v: 0, at } so merging never brings it back.
 */
export function update(mutate, message = "Update preferences from the app") {
  const next = structuredClone(getMe());
  mutate(next);
  me = next; local.set("me", me);
  const token = getToken();
  if (!token) { status = { state: "local", message: "" }; emit(); return Promise.resolve(); }
  status = { state: "saving", message: "" }; emit();
  queue = queue.then(async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const { data, sha } = await fetchRemote(token);
        const merged = merge(me, data);
        mutate(merged);
        const res = await fetch(API, {
          method: "PUT", headers: { ...headers(token), "Content-Type": "application/json" },
          body: JSON.stringify({ message, content: b64encode(JSON.stringify(merged, null, 1) + "\n"), branch: "main", ...(sha ? { sha } : {}) }),
        });
        if (res.status === 409 || res.status === 422) continue;     // someone else committed; retry on the new copy
        if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? "token can't write to the repo" : `GitHub ${res.status}`);
        me = merged; local.set("me", me);
        status = { state: "synced", message: "" }; emit();
        return;
      } catch (e) { status = { state: "error", message: e.message }; emit(); return; }
    }
    status = { state: "error", message: "couldn't save, try again" }; emit();
  });
  return queue;
}

export async function setToken(token) {
  token = token.trim();
  if (!token) { local.del("ghToken"); status = { state: "local", message: "" }; emit(); return true; }
  try { await fetchRemote(token); } catch (e) { status = { state: "error", message: e.message }; emit(); return false; }
  local.set("ghToken", token);
  await load();
  // Push anything this device collected before the token was added.
  await update(() => {}, "Sync preferences from a device");
  return status.state === "synced";
}
