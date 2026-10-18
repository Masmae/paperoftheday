// Settings: connect this device to GitHub so watch rules and learning progress
// are saved to data/me.json, where the daily run reads them.
import { h, masthead, kids } from "./dom.js";

export function showSettings({ view, sync }) {
  const st = sync.getStatus();
  const hasToken = !!sync.getToken();
  const input = h("input", { type: "password", class: "field", placeholder: "github_pat_…", autocomplete: "off", spellcheck: "false", "aria-label": "GitHub token" });
  const msg = h("p", { class: "note" });
  const save = h("button", { class: "btn primary", onclick: async () => {
    save.disabled = true; msg.textContent = "Checking…";
    const ok = await sync.setToken(input.value);
    save.disabled = false;
    msg.textContent = ok ? "Connected. Your watch rules and progress now save to GitHub." : `Didn't work: ${sync.getStatus().message}. Check the token's repository and permission.`;
    if (ok) setTimeout(() => showSettings({ view, sync }), 900);
  } }, "Connect");
  view.replaceChildren(...kids(
    masthead("Settings", "", st),
    h("div", { class: "section-title" }, "Sync to GitHub"),
    h("p", {}, hasToken
      ? `Connected${st.state === "error" ? `, but the last save failed: ${st.message}.` : "."} Watch rules and learning progress are saved to data/me.json, which the daily run uses.`
      : "Right now your watch rules and learning progress stay on this device. Connect a GitHub token so they're saved to the repo, where the daily run uses them to fill Watching and write your next lessons."),
    hasToken
      ? h("div", { class: "actions" }, h("button", { class: "btn", onclick: async () => { await sync.setToken(""); showSettings({ view, sync }); } }, "Disconnect this device"))
      : h("div", {},
        h("ol", { class: "steps" },
          h("li", {}, "Open ", h("a", { href: "https://github.com/settings/personal-access-tokens/new", target: "_blank", rel: "noopener noreferrer" }, "GitHub → new fine-grained token"), "."),
          h("li", {}, "Name it ", h("b", {}, "paperoftheday app"), ", and set an expiration (up to a year)."),
          h("li", {}, "Repository access: ", h("b", {}, "Only select repositories"), " → ", h("b", {}, "paperoftheday"), "."),
          h("li", {}, "Permissions → Repository → ", h("b", {}, "Contents: Read and write"), ". Nothing else."),
          h("li", {}, "Generate, copy, and paste it here.")),
        h("div", { class: "row" }, input, save), msg,
        h("p", { class: "note" }, "The token is stored only in this browser. It can edit only this one repo, and you can revoke it on GitHub anytime.")),
  ));
}
