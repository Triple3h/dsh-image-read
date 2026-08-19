/**
 * dsh-image-read — web client half (v0.4.0).
 *
 * Two capabilities in one bundle:
 *   A. Vision config card — Settings → Plugins → Plugin configuration.
 *      API key (credentials domain), timeout, max dimension.
 *   B. Attachment input — Ctrl+V paste, whole-page drag-drop, file/folder
 *      picker; bubble attachment folding into chips; usage/cleanup panel.
 *
 * Both halves share the ModuleLoader entry.  CSS prefixes stay distinct
 * (imgread-* / dshca-*) and slot registrations are complementary.
 */

window.__ModuleLoader__.load({
  id: "dsh-image-read",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    if (typeof window !== "undefined" && !window.__DSH_IMAGE_READ_BANNER__) {
      window.__DSH_IMAGE_READ_BANNER__ = true;
      console.log(
        "%c dsh-image-read %c v0.4.0 %c 图像识别 + 附件输入 ",
        "background:#4d6bfe;color:#fff;font-weight:600;padding:2px 6px;border-radius:4px 0 0 4px;",
        "background:#2b2d31;color:#fff;padding:2px 6px;",
        "background:#f3f4f6;color:#374151;border-radius:0 4px 4px 0;padding:2px 6px;"
      );
    }

    // ── 依赖引入 ────────────────────────────────────────────────────────
    const react = require("react");
    const h = react.createElement;
    const { jsx, jsxs, Fragment } = require("react/jsx-runtime");
    const { createSnapshotStore } = require("@deepseek-ai/dsh-client-runtime/client");
    const { IconChevronDownOutline14 } = require("@deepseek-ai/dsh-client-ui-primitives");

    const clsx = (...args) => {
      let out = "";
      for (const a of args) {
        if (!a) continue;
        if (typeof a === "string" || typeof a === "number") out += a + " ";
        else if (Array.isArray(a)) out += clsx(...a) + " ";
        else if (typeof a === "object") for (const k in a) if (a[k]) out += k + " ";
      }
      return out.trim();
    };

    // ── 常量 ────────────────────────────────────────────────────────────
    const IMAGE_READ_NS = "image-read";
    const API_KEY_FIELD = "apiKey";
    const DEFAULT_API_KEY_REF = "MIMO_API_KEY";
    const ATT_API = "/dsh-image-read/attachments/v1";
    const ATT_SOURCE = "dsh-image-read";

    // ════════════════════════════════════════════════════════════════════
    //  A. Vision config card  (imgread-* CSS)
    // ════════════════════════════════════════════════════════════════════

    const CSS_IMGREAD = `
.imgread-field{flex-direction:column;gap:6px;padding:12px 0;display:flex}
.imgread-field+.imgread-field{border-top:1px solid var(--dsw-alias-border-l2)}
.imgread-head{align-items:center;gap:8px;display:flex}
.imgread-label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}
.imgread-badges{align-items:center;gap:8px;display:inline-flex}
.imgread-badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}
.imgread-badgeMuted{white-space:nowrap;color:var(--dsw-alias-label-tertiary);border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px}
.imgread-reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5}
.imgread-reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
.imgread-reset:disabled{cursor:default}
.imgread-input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5}
.imgread-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
.imgread-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.imgread-inputInvalid{border-color:var(--dsw-alias-label-error)}
.imgread-invalid{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}
.imgread-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}
.imgread-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}
.imgread-card:hover{border-color:var(--dsw-alias-label-dimmed)}
.imgread-cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.imgread-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}
.imgread-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.imgread-headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}
.imgread-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}
.imgread-desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}
.imgread-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}
.imgread-chevronOpen{transform:rotate(180deg)}
.imgread-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}
.imgread-readOnly{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}
.imgread-pending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}
.imgread-footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}
.imgread-failed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}
.imgread-discard,.imgread-save{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}
.imgread-discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}
.imgread-discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.imgread-save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.imgread-discard:disabled,.imgread-save:disabled{opacity:.4;cursor:default}
.imgread-discard:focus-visible,.imgread-save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}`;

    // ════════════════════════════════════════════════════════════════════
    //  B. Attachment input  (dshca-* CSS, from dsh-paste-input)
    // ════════════════════════════════════════════════════════════════════

    const CSS_ATTACH = `
.dshca-wrap{position:relative;display:inline-flex;align-items:center}
.dshca-button{width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:0}
.dshca-button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dshca-button:disabled{opacity:.4;cursor:default}
.dshca-menu{position:absolute;left:0;bottom:34px;z-index:20;min-width:142px;padding:5px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base);box-shadow:var(--dsw-shadow-lv3);display:grid;gap:2px}
.dshca-menu button{border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:28px;text-align:left;padding:0 9px;cursor:pointer}
.dshca-menu button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshca-dock{box-sizing:border-box;width:calc(100% - 32px);max-width:var(--dsh-composer-card-max-width,960px);margin:0 auto;display:flex;flex-wrap:wrap;gap:6px;padding:0 2px 6px}
.dshca-chip{max-width:100%;min-width:min(180px,100%);height:32px;box-sizing:border-box;display:flex;align-items:center;gap:7px;padding:0 7px 0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-specific-tip);color:var(--dsw-alias-label-primary);font-size:12px}
.dshca-chip[data-status=uploading]{border-color:var(--dsw-alias-state-business-primary)}
.dshca-chip[data-status=error]{border-color:var(--dsw-alias-state-error-primary)}
.dshca-chip-icon{flex:none;display:inline-flex;align-items:center;color:var(--dsw-alias-label-secondary)}
.dshca-chip-icon svg{width:14px;height:14px}
.dshca-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:320px}
.dshca-meta{flex:none;color:var(--dsw-alias-label-caption);white-space:nowrap}
.dshca-remove{flex:none;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:50%;background:transparent;color:var(--dsw-alias-label-caption);cursor:pointer;padding:0;font-size:16px;line-height:1}
.dshca-remove:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshca-error{max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-state-error-primary)}
.dshca-settings{display:flex;flex-direction:column;gap:18px;width:100%;color:var(--dsw-alias-label-primary)}
.dshca-settings-head{display:flex;flex-direction:column;gap:5px}
.dshca-settings-title{font-size:18px;line-height:26px;font-weight:600}
.dshca-settings-copy{max-width:620px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.dshca-settings-card{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1)}
.dshca-settings-scope{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:-10px;color:var(--dsw-alias-label-secondary);font-size:12px}
.dshca-stat{display:flex;flex-direction:column;gap:4px;min-width:0}
.dshca-stat strong{font-size:20px;line-height:28px;font-weight:600;font-variant-numeric:tabular-nums}
.dshca-stat span{color:var(--dsw-alias-label-caption);font-size:12px}
.dshca-settings-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dshca-settings-action{height:32px;padding:0 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
.dshca-settings-action:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshca-settings-action[data-danger=true]{color:var(--dsw-alias-state-error-primary)}
.dshca-settings-action:disabled{opacity:.45;cursor:default}
.dshca-settings-status{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
@media(max-width:720px){.dshca-settings-card{grid-template-columns:1fr}.dshca-dock{width:calc(100% - 16px)}}
.dshca-notice-overlay{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45)}
.dshca-notice{width:min(420px,calc(100vw - 48px));box-sizing:border-box;padding:18px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-base);box-shadow:var(--dsw-shadow-lv3);display:flex;flex-direction:column;gap:10px;color:var(--dsw-alias-label-primary)}
.dshca-notice-title{font-size:15px;font-weight:600}
.dshca-notice-copy{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.dshca-notice-check{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;user-select:none}
.dshca-notice-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:2px}
.dshca-notice-actions button{height:30px;padding:0 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
.dshca-notice-actions button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshca-notice-actions .dshca-notice-ok{background:var(--dsw-alias-state-business-primary);border-color:transparent;color:#fff}
.dshca-toast{position:fixed;left:50%;bottom:64px;transform:translateX(-50%);z-index:100;max-width:min(560px,calc(100vw - 48px));box-sizing:border-box;padding:9px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);font-size:13px;line-height:18px;pointer-events:none;opacity:0;transition:opacity .18s ease}
.dshca-toast[data-show=true]{opacity:1}
.dshca-chat-attachments{display:flex;flex-wrap:wrap;gap:6px;padding:0}
.dshca-chat-chip{position:relative;max-width:100%;min-width:0;height:30px;box-sizing:border-box;display:inline-flex;align-items:center;gap:7px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-specific-tip);color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer}
.dshca-chat-chip:hover{border-color:var(--dsw-alias-state-business-primary)}
.dshca-chat-chip-icon{flex:none;display:inline-flex;align-items:center;color:var(--dsw-alias-label-secondary)}
.dshca-chat-chip-icon svg{width:14px;height:14px}
.dshca-chat-chip-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshca-chat-chip-meta{flex:none;color:var(--dsw-alias-label-caption);white-space:nowrap}
.dshca-chat-tip{display:none;position:absolute;bottom:calc(100% + 6px);left:0;z-index:40;min-width:260px;max-width:min(520px,78vw);box-sizing:border-box;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base);box-shadow:var(--dsw-shadow-lv3);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-all;pointer-events:none}
.dshca-chat-chip:hover .dshca-chat-tip{display:block}
[data-paste-folded="1"]{display:none!important}
.dshca-chat-usertext{flex:0 0 100%;white-space:pre-wrap;word-break:break-word;color:inherit;font:inherit}`;

    // ── Inject both style blocks ─────────────────────────────────────────
    if (typeof document !== "undefined") {
      if (!document.querySelector('style[data-plugin="dsh-image-read-ui"]')) {
        const tagA = document.createElement("style");
        tagA.dataset.plugin = "dsh-image-read-ui";
        tagA.textContent = CSS_IMGREAD;
        document.head.appendChild(tagA);
      }
      if (!document.querySelector('style[data-plugin-css="dsh-image-read-attach"]')) {
        const tagB = document.createElement("style");
        tagB.dataset.plugin = "dsh-image-read";
        tagB.dataset.pluginCss = "dsh-image-read-attach";
        tagB.textContent = CSS_ATTACH;
        document.head.appendChild(tagB);
      }
    }

    // ── A. CSS class map ─────────────────────────────────────────────────
    const C = {
      field: "imgread-field", head: "imgread-head", label: "imgread-label",
      input: "imgread-input", inputInvalid: "imgread-inputInvalid",
      invalid: "imgread-invalid", hint: "imgread-hint",
      badges: "imgread-badges", badge: "imgread-badge", badgeMuted: "imgread-badgeMuted",
      reset: "imgread-reset",
      card: "imgread-card", cardOpen: "imgread-cardOpen",
      header: "imgread-header", headText: "imgread-headText",
      name: "imgread-name", desc: "imgread-desc",
      chevron: "imgread-chevron", chevronOpen: "imgread-chevronOpen",
      body: "imgread-body", readOnly: "imgread-readOnly",
      pending: "imgread-pending", footer: "imgread-footer",
      failed: "imgread-failed", discard: "imgread-discard", save: "imgread-save",
    };

    // ════════════════════════════════════════════════════════════════════
    //  A. Vision config card — field specs & CardForm
    // ════════════════════════════════════════════════════════════════════

    function numberField(field) {
      return {
        field,
        format: (v) => typeof v === "number" ? String(v) : "",
        parse: (t) => { const s = t.trim(); if (s === "") return { kind: "clear" }; const n = Number(s); return Number.isFinite(n) ? { kind: "set", value: n } : void 0; },
      };
    }

    function textField(field) {
      return {
        field,
        format: (v) => typeof v === "string" ? v : "",
        parse: (t) => { const s = t.trim(); if (s === "") return { kind: "clear" }; return { kind: "set", value: s }; },
      };
    }

    class CardForm {
      constructor(scope, specs, secrets = []) {
        this.scope = scope;
        this.specs = new Map(specs.map((s) => [s.field, s]));
        this.secretSpecs = new Map(secrets.map((s) => [s.field, s]));
        this.staged = new Map();
        this.listeners = new Set();
        this.saving = false;
        this.failed = false;
        scope.subscribe(() => this.publish());
      }
      bind(project) { const store = createSnapshotStore(project()); this.listeners.add(() => store.set(project())); return store; }
      shell() {
        const snap = this.scope.getSnapshot();
        const plan = this.plan();
        return { available: snap.status === "ready", writable: snap.writable, dirty: plan.length > 0, invalid: plan.some((i) => i.run === void 0), saving: this.saving, failed: this.failed };
      }
      field(field) {
        const staged = this.staged.get(field);
        if (this.secretSpecs.has(field)) return { text: staged?.text ?? "", overridden: false, invalid: false };
        const spec = this.spec(field);
        if (staged === void 0) return { text: spec.format(this.sectionValue(field)), overridden: this.stored(field), invalid: false };
        const write = staged.clear ? { kind: "clear" } : spec.parse(staged.text);
        return { text: staged.text, overridden: write?.kind === "set", invalid: write === void 0 };
      }
      actions() {
        return {
          edit: (f, text) => this.stage(f, { text, clear: false }),
          resetField: (f) => this.stage(f, { text: this.spec(f).format(this.baseValue(f)), clear: true }),
          save: () => this.save(),
          discard: () => { if (this.staged.size === 0 && !this.failed) return; this.staged.clear(); this.failed = false; this.publish(); },
        };
      }
      async save() {
        const plan = this.plan();
        const writes = plan.flatMap((i) => i.run === void 0 ? [] : [i.run]);
        if (plan.length === 0 || this.saving || writes.length !== plan.length) return;
        this.saving = true; this.failed = false; this.publish();
        let ok = true;
        for (const w of writes) ok = await w() && ok;
        if (ok) this.staged.clear();
        this.saving = false; this.failed = !ok; this.publish();
      }
      plan() {
        const plan = [];
        for (const [f, staged] of this.staged) {
          const secret = this.secretSpecs.get(f);
          if (secret !== void 0) { const v = staged.text.trim(); if (v !== "") plan.push({ field: f, run: () => secret.write(v) }); continue; }
          const spec = this.spec(f);
          if (staged.clear) { if (this.stored(f)) plan.push({ field: f, run: () => this.clear(f) }); continue; }
          if (staged.text === spec.format(this.sectionValue(f))) continue;
          const write = spec.parse(staged.text);
          if (write === void 0) plan.push({ field: f, run: void 0 });
          else if (write.kind === "clear") plan.push({ field: f, run: () => this.clear(f) });
          else plan.push({ field: f, run: () => this.store(f, write.value) });
        }
        return plan;
      }
      async clear(f) { await this.scope.unset(f); return !this.stored(f); }
      async store(f, v) { await this.scope.set(f, v); return this.userLayer()?.[f] === v; }
      stage(f, e) { this.staged.set(f, e); this.failed = false; this.publish(); }
      spec(f) { const s = this.specs.get(f); if (!s) throw new Error(`no field ${f}`); return s; }
      snapshotOf() { return this.scope.getSnapshot(); }
      sectionValue(f) { return this.snapshotOf().value?.[f]; }
      baseValue(f) { return this.snapshotOf().base?.[f]; }
      userLayer() { return this.snapshotOf().user; }
      stored(f) { const u = this.userLayer(); return u !== void 0 && Object.hasOwn(u, f); }
      publish() { for (const l of this.listeners) l(); }
    }

    function ValueField(props) {
      return jsxs("div", { className: C.field, children: [
        jsxs("div", { className: C.head, children: [
          jsx("label", { className: C.label, htmlFor: props.id, children: props.label }),
          props.overridden ? jsxs("span", { className: C.badges, children: [jsx("span", { className: C.badge, children: props.overriddenLabel }), jsx("button", { type: "button", className: C.reset, disabled: props.disabled, onClick: props.onReset, children: props.resetLabel })] }) : null,
        ] }),
        jsx("input", { id: props.id, className: props.invalid ? C.inputInvalid : C.input, type: "text", ...props.numeric === true ? { inputMode: "numeric" } : {}, ...props.invalid ? { "aria-invalid": true } : {}, value: props.text, placeholder: props.placeholder ?? "", disabled: props.disabled, onChange: (e) => props.onEdit(e.target.value) }),
        jsx("p", { className: props.invalid ? C.invalid : C.hint, children: props.invalid ? props.invalidLabel : props.hint }),
      ] });
    }

    function SecretField(props) {
      return jsxs("div", { className: C.field, children: [
        jsxs("div", { className: C.head, children: [
          jsx("label", { className: C.label, htmlFor: props.id, children: props.label }),
          jsx("span", { className: C.badges, children: jsx("span", { className: props.configured ? C.badge : C.badgeMuted, children: props.stateLabel }) }),
        ] }),
        jsx("input", { id: props.id, className: C.input, type: "password", autoComplete: "off", value: props.text, disabled: props.disabled, onChange: (e) => props.onEdit(e.target.value) }),
        jsx("p", { className: C.hint, children: props.hint }),
      ] });
    }

    function PluginCard(props) {
      const [open, setOpen] = react.useState(false);
      const { state } = props;
      if (!state.available) return null;
      const title = props.t(props.titleKey);
      const blocked = !state.dirty || state.invalid || state.saving;
      return jsxs("li", { className: clsx(C.card, open && C.cardOpen), children: [
        jsxs("button", { type: "button", className: C.header, "aria-expanded": open, "aria-label": `${props.t(open ? "collapse" : "expand")}: ${title}`, onClick: () => setOpen(!open), children: [
          jsxs("span", { className: C.headText, children: [jsx("span", { className: C.name, children: title }), jsx("span", { className: C.desc, children: props.t(props.descriptionKey) })] }),
          state.dirty ? jsx("span", { className: C.pending, children: props.t("unsaved") }) : null,
          jsx(IconChevronDownOutline14, { className: clsx(C.chevron, open && C.chevronOpen) }),
        ] }),
        open ? jsxs("div", { className: C.body, children: [
          !state.writable ? jsx("p", { className: C.readOnly, role: "status", children: props.t("readOnly") }) : null,
          props.children,
          jsxs("div", { className: C.footer, children: [
            state.failed ? jsx("p", { className: C.failed, role: "status", children: props.t("saveFailed") }) : null,
            jsx("button", { type: "button", className: C.discard, disabled: !state.dirty || state.saving, onClick: props.onDiscard, children: props.t("discard") }),
            jsx("button", { type: "button", className: C.save, disabled: blocked, onClick: props.onSave, children: props.t(state.saving ? "saving" : "save") }),
          ] }),
        ] }) : null,
      ] });
    }

    // ── A. Controller ────────────────────────────────────────────────────

    class ImageReadCardController {
      constructor(scope, api) {
        this.scope = scope;
        this.api = api;
        this.credential = { ref: "", configured: false, writable: true };
        this.form = new CardForm(scope, [textField("baseUrl"), textField("model"), numberField("timeoutMs"), numberField("maxImageDimension")], [{ field: API_KEY_FIELD, write: (t) => this.writeKey(t) }]);
        this.store = this.form.bind(() => this.projection());
        scope.subscribe(() => this.readCredential());
        this.readCredential();
      }
      projection() {
        return { ...this.form.shell(), baseUrl: this.form.field("baseUrl"), model: this.form.field("model"), timeoutMs: this.form.field("timeoutMs"), maxImageDimension: this.form.field("maxImageDimension"), apiKey: this.form.field(API_KEY_FIELD), apiKeyConfigured: this.credential.configured, apiKeyWritable: this.credential.writable };
      }
      async readCredential() {
        const ref = this.refOf(this.scope.getSnapshot());
        if (ref !== this.credential.ref) { this.credential = { ref, configured: false, writable: true }; this.store.set(this.projection()); }
        let response; try { response = await this.api.credentials.describe({ refs: [ref] }); } catch { return; }
        if (!response.result.ok || ref !== this.refOf(this.scope.getSnapshot())) return;
        const view = response.result.value.credentials[ref];
        const next = { ref, configured: view?.configured ?? false, writable: view?.writable ?? true };
        if (next.configured === this.credential.configured && next.writable === this.credential.writable) return;
        this.credential = next; this.store.set(this.projection());
      }
      refreshCredential(ref) { if (ref !== this.credential.ref) return; this.readCredential(); }
      inject() { return { hooks: { imageReadCard: this.store }, ...this.form.actions() }; }
      async writeKey(value) { try { await this.api.credentials.set({ ref: this.refOf(this.scope.getSnapshot()), value }); } catch {} await this.readCredential(); return this.credential.configured; }
      refOf(snapshot) {
        const providers = snapshot.value?.providers;
        if (Array.isArray(providers) && providers.length > 0 && providers[0].name) return `IMAGE_READ_${providers[0].name.toUpperCase()}_API_KEY`;
        return DEFAULT_API_KEY_REF;
      }
    }

    // ── A. Card component ────────────────────────────────────────────────

    function ImageReadCard(props) {
      const { t } = props;
      const state = props.useImageReadCard((s) => s);
      const disabled = !state.writable;
      return jsxs(PluginCard, {
        t, titleKey: "imageReadTitle", descriptionKey: "imageReadDescription",
        state, onSave: props.save, onDiscard: props.discard,
        children: [
          jsx(ValueField, { id: "imgread-baseurl", label: t("baseUrl"), hint: t("baseUrlHint"), overriddenLabel: t("overridden"), resetLabel: t("reset"), disabled, ...state.baseUrl, onEdit: (t2) => props.edit("baseUrl", t2), onReset: () => props.resetField("baseUrl") }),
          jsx(ValueField, { id: "imgread-model", label: t("model"), hint: t("modelHint"), overriddenLabel: t("overridden"), resetLabel: t("reset"), disabled, ...state.model, onEdit: (t2) => props.edit("model", t2), onReset: () => props.resetField("model") }),
          jsx(SecretField, { id: "imgread-apikey", label: t("apiKey"), hint: t("apiKeyHint"), disabled: !state.apiKeyWritable, text: state.apiKey.text, configured: state.apiKeyConfigured, stateLabel: state.apiKeyConfigured ? t("apiKeySet") : t("apiKeyUnset"), onEdit: (t2) => props.edit("apiKey", t2) }),
          jsx(ValueField, { id: "imgread-timeout", label: t("timeoutMs"), hint: t("timeoutMsHint"), overriddenLabel: t("overridden"), resetLabel: t("reset"), invalidLabel: t("invalidNumber"), numeric: true, disabled, ...state.timeoutMs, onEdit: (t2) => props.edit("timeoutMs", t2), onReset: () => props.resetField("timeoutMs") }),
          jsx(ValueField, { id: "imgread-maxdim", label: t("maxImageDimension"), hint: t("maxImageDimensionHint"), overriddenLabel: t("overridden"), resetLabel: t("reset"), invalidLabel: t("invalidNumber"), numeric: true, disabled, ...state.maxImageDimension, onEdit: (t2) => props.edit("maxImageDimension", t2), onReset: () => props.resetField("maxImageDimension") }),
        ],
      });
    }

    // ════════════════════════════════════════════════════════════════════
    //  B. Attachment input — state, helpers, UI
    // ════════════════════════════════════════════════════════════════════

    const records = new Map();
    const attListeners = new Set();
    let attRevision = 0;

    function attChanged() { attRevision += 1; for (const l of [...attListeners]) l(); }
    function useAttRevision() {
      return react.useSyncExternalStore((l) => { attListeners.add(l); return () => attListeners.delete(l); }, () => attRevision, () => attRevision);
    }
    function attId() { return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }

    function humanBytes(value) {
      if (value < 1024) return `${value} B`;
      const units = ["KiB", "MiB", "GiB", "TiB"]; let next = value / 1024; let unit = units[0];
      for (let i = 1; i < units.length && next >= 1024; i += 1) { next /= 1024; unit = units[i]; }
      return `${next >= 10 ? next.toFixed(0) : next.toFixed(1)} ${unit}`;
    }

    function compactReferenceLabel(label) {
      const prefix = label.length > 8 ? `${label.slice(0, 8)}…` : label;
      return `📎 ${prefix}`;
    }

    function normalizeRelativePath(value, fallback) {
      const p = (value || fallback).replaceAll("\\", "/").replace(/^\/+/, "");
      const parts = p.split("/").filter(Boolean);
      if (parts.length === 0 || parts.some((x) => x === "." || x === "..")) throw new Error(`Unsafe attachment path: ${p}`);
      return parts.join("/");
    }

    function validateItems(items) {
      if (items.length === 0) throw new Error("No files were selected");
      if (items.length > 10_000) throw new Error("Selection exceeds 10,000 files");
      let total = 0; const paths = new Set();
      for (const item of items) {
        if (item.path.split("/").length > 64) throw new Error(`${item.path} exceeds 64 directory levels`);
        if (item.file.size > 1024 ** 3) throw new Error(`${item.path} exceeds 1 GiB`);
        total += item.file.size;
        if (total > 2 * 1024 ** 3) throw new Error("Selection exceeds 2 GiB");
        if (paths.has(item.path)) throw new Error(`Duplicate attachment path: ${item.path}`);
        paths.add(item.path);
      }
      return total;
    }

    function filesFromList(list) {
      return [...list].map((file) => ({ file, path: normalizeRelativePath(file.webkitRelativePath, file.name) }));
    }
    function entryFile(entry) { return new Promise((res, rej) => entry.file(res, rej)); }
    async function readAllEntries(reader) {
      const out = [];
      while (true) { const batch = await new Promise((res, rej) => reader.readEntries(res, rej)); if (batch.length === 0) return out; out.push(...batch); }
    }
    async function walkEntry(entry, prefix = "") {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isFile) { const file = await entryFile(entry); return [{ file, path: normalizeRelativePath(rel, file.name) }]; }
      if (!entry.isDirectory) return [];
      const children = await readAllEntries(entry.createReader());
      const nested = await Promise.all(children.map((c) => walkEntry(c, rel)));
      return nested.flat();
    }
    async function filesFromDrop(dt) {
      const entries = [...dt.items].filter((i) => i.kind === "file").map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
      if (entries.length === 0) return filesFromList(dt.files);
      const nested = await Promise.all(entries.map((e) => walkEntry(e)));
      return nested.flat();
    }
    async function responseJson(response) {
      let value; try { value = await response.json(); } catch { throw new Error(`Attachment Host returned HTTP ${response.status}`); }
      if (!response.ok || value?.ok !== true) throw new Error(value?.error?.message ?? `Attachment Host returned HTTP ${response.status}`);
      return value;
    }

    function modelMessage(committed) {
      const visible = committed.files.slice(0, 50);
      const lines = ["", "==== DSH_IMAGE_READ_ATTACHMENT_V1 ====", committed.root, "", `Files: ${committed.files.length}`, `Manifest: ${committed.manifest.slice(committed.root.length + 1)}`, "Attached files (paths are relative to the root above):"];
      for (const f of visible) lines.push(`- ${JSON.stringify(f.actualPath)} (${humanBytes(f.size)})${f.originalPath === f.actualPath ? "" : `; original=${JSON.stringify(f.originalPath)}`}`);
      if (committed.files.length > visible.length) lines.push(`- ... ${committed.files.length - visible.length} more; read the manifest for the complete mapping`);
      lines.push("==== END DSH_IMAGE_READ_ATTACHMENT ====", "");
      return lines.join("\n");
    }

    async function upload(record, signal) {
      if (record.committed !== undefined) return record.modelText;
      if (record.inflight !== undefined) return record.inflight;
      const task = (async () => {
        record.status = "uploading"; record.error = undefined; record.uploaded = 0; attChanged();
        let batchId;
        try {
          const created = await responseJson(await fetch(`${ATT_API}/batches`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: record.sessionId, files: record.items.map((i) => ({ path: i.path, size: i.file.size, type: i.file.type, lastModified: i.file.lastModified })) }), signal }));
          batchId = created.batchId;
          let cursor = 0;
          const worker = async () => {
            while (cursor < record.items.length) {
              const idx = cursor++;
              const item = record.items[idx];
              await responseJson(await fetch(`${ATT_API}/batches/${encodeURIComponent(batchId)}/files/${idx}`, { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: item.file, signal }));
              record.uploaded += 1; attChanged();
            }
          };
          await Promise.all(Array.from({ length: Math.min(2, record.items.length) }, worker));
          const committed = await responseJson(await fetch(`${ATT_API}/batches/${encodeURIComponent(batchId)}/commit`, { method: "POST", signal }));
          record.committed = committed; record.modelText = modelMessage(committed); record.status = "uploaded"; attChanged();
          return record.modelText;
        } catch (cause) {
          if (batchId !== undefined) fetch(`${ATT_API}/batches/${encodeURIComponent(batchId)}`, { method: "DELETE" }).catch(() => {});
          record.status = "error"; record.error = cause instanceof Error ? cause.message : String(cause); attChanged(); throw cause;
        } finally { record.inflight = undefined; }
      })();
      record.inflight = task;
      return task;
    }

    function pickFiles(kind, onFiles, onError) {
      const input = document.createElement("input");
      input.type = "file"; input.multiple = true;
      if (kind === "folder") input.setAttribute("webkitdirectory", "");
      input.addEventListener("change", () => { try { onFiles(filesFromList(input.files ?? [])); } catch (c) { onError(c); } }, { once: true });
      input.click();
    }

    // ── Toast & notice ───────────────────────────────────────────────────
    function showToast(message) {
      const toast = document.createElement("div");
      toast.className = "dshca-toast"; toast.textContent = message;
      document.body.appendChild(toast);
      requestAnimationFrame(() => { toast.dataset.show = "true"; });
      setTimeout(() => { toast.dataset.show = "false"; setTimeout(() => toast.remove(), 220); }, 4000);
    }

    const NOTICE_KEY = "dsh-image-read.attach-notice.v1";
    let noticeDismissed = false;
    try { noticeDismissed = localStorage.getItem(NOTICE_KEY) === "1"; } catch { /* noop */ }

    function showPasteNotice(onConfirm, onCancel) {
      const overlay = document.createElement("div");
      overlay.className = "dshca-notice-overlay";
      const card = document.createElement("div");
      card.className = "dshca-notice"; card.setAttribute("role", "dialog"); card.setAttribute("aria-modal", "true"); card.setAttribute("aria-label", "粘贴文件提示");
      const title = document.createElement("div"); title.className = "dshca-notice-title"; title.textContent = "粘贴文件提示";
      const copy = document.createElement("div"); copy.className = "dshca-notice-copy"; copy.textContent = "你粘贴了图片或文件。DSH Image Read 会把它们复制到当前会话工作区的临时附件目录（.dsh/tmp/attachments/），并在发送时随消息一起交给模型。";
      const label = document.createElement("label"); label.className = "dshca-notice-check";
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = true;
      label.appendChild(cb); label.appendChild(document.createTextNode(" 我已了解，不再提示"));
      const actions = document.createElement("div"); actions.className = "dshca-notice-actions";
      const cancelBtn = document.createElement("button"); cancelBtn.type = "button"; cancelBtn.className = "dshca-notice-cancel"; cancelBtn.textContent = "取消";
      const okBtn = document.createElement("button"); okBtn.type = "button"; okBtn.className = "dshca-notice-ok"; okBtn.textContent = "确定";
      actions.appendChild(cancelBtn); actions.appendChild(okBtn);
      card.appendChild(title); card.appendChild(copy); card.appendChild(label); card.appendChild(actions);
      overlay.appendChild(card); document.body.appendChild(overlay);
      okBtn.addEventListener("click", () => { try { if (cb.checked) localStorage.setItem(NOTICE_KEY, "1"); } catch { /* noop */ } noticeDismissed = noticeDismissed || cb.checked; overlay.remove(); onConfirm(); });
      cancelBtn.addEventListener("click", () => { overlay.remove(); onCancel?.(); });
      overlay.addEventListener("click", (e) => { if (e.target === overlay) { overlay.remove(); onCancel?.(); } });
    }

    // ── Attach button & chips ────────────────────────────────────────────
    function PaperclipSvg() {
      return h("svg", { width: 15, height: 15, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true },
        h("path", { d: "M5.2 8.6 9.8 4a2.1 2.1 0 1 1 3 3l-5.9 5.9a3.4 3.4 0 0 1-4.8-4.8l6-6", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" }));
    }

    function AttachButton(props) {
      const [open, setOpen] = react.useState(false);
      const [busy, setBusy] = react.useState(false);
      const [message, setMessage] = react.useState("");
      const locked = props.input.phase !== "plain";
      const accept = react.useCallback(async (itemsOrPromise) => {
        setBusy(true); setMessage("");
        try { const items = await itemsOrPromise; await props.add(items); setOpen(false); }
        catch (c) { setMessage(c instanceof Error ? c.message : String(c)); }
        finally { setBusy(false); }
      }, [props.add]);
      return h("div", { className: "dshca-wrap" },
        h("button", { type: "button", className: "dshca-button", title: message || "Attach files or a folder", "aria-label": message || "Attach files or a folder", "aria-expanded": open, disabled: locked || busy, onClick: () => setOpen((v) => !v) }, h(PaperclipSvg)),
        open && h("div", { className: "dshca-menu", role: "menu" },
          h("button", { type: "button", role: "menuitem", onClick: () => pickFiles("files", (items) => void accept(items), (c) => setMessage(String(c))) }, "Choose files"),
          h("button", { type: "button", role: "menuitem", onClick: () => pickFiles("folder", (items) => void accept(items), (c) => setMessage(String(c))) }, "Choose folder")));
    }

    function AttachmentChips(props, className) {
      const occurrences = props.input.occurrences.filter((i) => i.source === ATT_SOURCE);
      if (occurrences.length === 0) return null;
      return h("div", { className }, ...occurrences.map((occ) => {
        const record = records.get(occ.ref);
        const status = record?.status ?? "missing";
        const meta = status === "uploading" ? `${record.uploaded}/${record.items.length}` : status === "uploaded" ? "copied" : record === undefined ? "unavailable" : humanBytes(record.total);
        return h("div", { className: "dshca-chip", "data-status": status, key: occ.occurrenceId },
          h("span", { className: "dshca-chip-icon", "aria-hidden": true }, h(PaperclipSvg)),
          h("span", { className: "dshca-name", title: record?.label ?? occ.label }, record?.label ?? occ.label),
          h("span", { className: status === "error" ? "dshca-error" : "dshca-meta", title: record?.error }, status === "error" ? record.error : meta),
          h("button", { type: "button", className: "dshca-remove", "aria-label": `Remove ${record?.label ?? occ.label}`, disabled: props.input.phase !== "plain", onClick: () => props.remove(occ) }, "×"));
      }));
    }

    function AttachmentDock(props) { useAttRevision(); return AttachmentChips(props, "dshca-dock"); }

    // ── Attachment settings panel ────────────────────────────────────────
    function attachmentCopy() {
      const zh = typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("zh");
      return zh ? {
        nav: "附件管理", title: "附件管理与空间清理", copy: "附件只在发送时复制到当前会话工作区；从输入框删除的附件不会上传。空间统计仅在打开本页或手动刷新时执行。", sends: "已发送批次", files: "文件", size: "占用空间", refresh: "刷新统计", currentScope: "当前会话", workspaceScope: (u) => `当前工作区 · ${u.sessionDirectories} 个有附件的会话`, cleanCurrent: "清理当前会话附件", cleanWorkspace: "清理当前工作区全部会话附件", confirmCurrent: "将只删除当前会话中由本插件创建的临时附件。请再次点击确认。", confirmWorkspace: "将删除当前工作区所有会话由本插件创建的临时附件；不会影响其他工作区。请再次点击确认。", confirmCurrentButton: "再次点击：清理当前会话", confirmWorkspaceButton: "再次点击：清理当前工作区", cancel: "取消", noSession: "请先打开一个会话。", loading: "正在读取当前会话附件…", cleanedCurrent: (r) => `已清理当前会话 ${r.deletedFiles} 个文件（${humanBytes(r.deletedBytes)}）。`, cleanedWorkspace: (r) => `已清理当前工作区 ${r.deletedSessionDirectories} 个会话目录、${r.deletedFiles} 个文件（${humanBytes(r.deletedBytes)}）。`,
      } : {
        nav: "Attachments", title: "Attachment management & cleanup", copy: "Attachments are copied into the active workspace only when you send. Removing one from the composer cancels it. Usage is read only when this page opens or you refresh it.", sends: "Sent batches", files: "Files", size: "Disk usage", refresh: "Refresh usage", currentScope: "Active session", workspaceScope: (u) => `Active workspace · ${u.sessionDirectories} sessions with attachments`, cleanCurrent: "Clean active session", cleanWorkspace: "Clean every session in this workspace", confirmCurrent: "Only temporary attachments created by this plugin in the active session will be deleted. Click again to confirm.", confirmWorkspace: "Temporary attachments in every session in this workspace will be deleted. Other workspaces are not affected. Click again to confirm.", confirmCurrentButton: "Confirm: clean active session", confirmWorkspaceButton: "Confirm: clean workspace", cancel: "Cancel", noSession: "Open a session first.", loading: "Reading attachments for the active session…", cleanedCurrent: (r) => `Removed ${r.deletedFiles} files from the active session (${humanBytes(r.deletedBytes)}).`, cleanedWorkspace: (r) => `Removed ${r.deletedFiles} files from ${r.deletedSessionDirectories} session directories in this workspace (${humanBytes(r.deletedBytes)}).`,
      };
    }

    async function sessionRequest(path, sessionId, signal) {
      return responseJson(await fetch(`${ATT_API}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId }), signal }));
    }

    function AttachmentSettings(props) {
      const copy = attachmentCopy();
      const list = react.useSyncExternalStore((l) => props.sessions.list.subscribe(l), () => props.sessions.list.getSnapshot(), () => props.sessions.list.getSnapshot());
      const sessionId = list.current;
      const [usage, setUsage] = react.useState({ sends: 0, files: 0, bytes: 0 });
      const [wsUsage, setWsUsage] = react.useState({ sessionDirectories: 0, sends: 0, files: 0, bytes: 0 });
      const [status, setStatus] = react.useState(sessionId === undefined ? copy.noSession : copy.loading);
      const [busy, setBusy] = react.useState(false);
      const [confirming, setConfirming] = react.useState(null);

      const load = react.useCallback(async (signal) => {
        if (sessionId === undefined) { setUsage({ sends: 0, files: 0, bytes: 0 }); setWsUsage({ sessionDirectories: 0, sends: 0, files: 0, bytes: 0 }); setStatus(copy.noSession); return; }
        setBusy(true); setStatus(copy.loading);
        try {
          const [n, w] = await Promise.all([sessionRequest("/usage/session", sessionId, signal), sessionRequest("/usage/workspace", sessionId, signal)]);
          setUsage({ sends: n.sends, files: n.files, bytes: n.bytes });
          setWsUsage({ sessionDirectories: w.sessionDirectories, sends: w.sends, files: w.files, bytes: w.bytes });
          setStatus("");
        } catch (c) { if (c?.name !== "AbortError") setStatus(c instanceof Error ? c.message : String(c)); }
        finally { if (!signal?.aborted) setBusy(false); }
      }, [sessionId]);

      react.useEffect(() => { const ctrl = new AbortController(); void load(ctrl.signal); return () => ctrl.abort(); }, [load]);

      const clean = async (scope) => {
        if (sessionId === undefined) return;
        if (confirming !== scope) { setConfirming(scope); setStatus(scope === "session" ? copy.confirmCurrent : copy.confirmWorkspace); return; }
        setConfirming(null); setBusy(true); setStatus("");
        try {
          const r = await sessionRequest(`/cleanup/${scope}`, sessionId);
          if (scope === "workspace") { setUsage({ sends: 0, files: 0, bytes: 0 }); setWsUsage({ sessionDirectories: 0, sends: 0, files: 0, bytes: 0 }); setStatus(copy.cleanedWorkspace(r)); }
          else { setUsage({ sends: 0, files: 0, bytes: 0 }); setWsUsage((cur) => ({ sessionDirectories: Math.max(0, cur.sessionDirectories - 1), sends: Math.max(0, cur.sends - r.deletedSends), files: Math.max(0, cur.files - r.deletedFiles), bytes: Math.max(0, cur.bytes - r.deletedBytes) })); setStatus(copy.cleanedCurrent(r)); }
        } catch (c) { setStatus(c instanceof Error ? c.message : String(c)); }
        finally { setBusy(false); }
      };

      return h("div", { className: "dshca-settings" },
        h("div", { className: "dshca-settings-head" }, h("div", { className: "dshca-settings-title" }, copy.title), h("div", { className: "dshca-settings-copy" }, copy.copy)),
        h("div", { className: "dshca-settings-scope" }, h("span", null, copy.currentScope)),
        h("div", { className: "dshca-settings-card" },
          h("div", { className: "dshca-stat" }, h("strong", null, String(usage.sends)), h("span", null, copy.sends)),
          h("div", { className: "dshca-stat" }, h("strong", null, String(usage.files)), h("span", null, copy.files)),
          h("div", { className: "dshca-stat" }, h("strong", null, humanBytes(usage.bytes)), h("span", null, copy.size))),
        h("div", { className: "dshca-settings-actions" },
          h("button", { type: "button", className: "dshca-settings-action", disabled: busy || sessionId === undefined, onClick: () => void load() }, copy.refresh),
          h("button", { type: "button", className: "dshca-settings-action", "data-danger": true, disabled: busy || sessionId === undefined || usage.sends === 0, onClick: () => void clean("session") }, confirming === "session" ? copy.confirmCurrentButton : copy.cleanCurrent),
          h("button", { type: "button", className: "dshca-settings-action", "data-danger": true, disabled: busy || sessionId === undefined || wsUsage.sends === 0, onClick: () => void clean("workspace") }, confirming === "workspace" ? copy.confirmWorkspaceButton : copy.cleanWorkspace),
          confirming !== null && h("button", { type: "button", className: "dshca-settings-action", disabled: busy, onClick: () => { setConfirming(null); setStatus(""); } }, copy.cancel)),
        h("div", { className: "dshca-settings-status" }, copy.workspaceScope(wsUsage), " · ", humanBytes(wsUsage.bytes)),
        status && h("div", { className: "dshca-settings-status", role: "status" }, status));
    }

    // ── Bubble attachment folding ────────────────────────────────────────
    const ATT_START_MARKER = "==== DSH_IMAGE_READ_ATTACHMENT_V1 ====";
    const ATT_END_MARKER = "==== END DSH_IMAGE_READ_ATTACHMENT ====";

    function parseAttachmentBlock(text) {
      const lines = text.split("\n");
      const startIdx = lines.findIndex((l) => l.trim().startsWith(ATT_START_MARKER));
      const endIdx = startIdx !== -1 ? lines.findIndex((l, i) => i > startIdx && l.trim().startsWith(ATT_END_MARKER)) : -1;
      if (startIdx === -1 || endIdx === -1) return null;
      const startMatch = /^(==== DSH_IMAGE_READ_ATTACHMENT_V1 ====)/.exec(lines[startIdx].trim());
      const endMatch = /^(==== END DSH_IMAGE_READ_ATTACHMENT ====)/.exec(lines[endIdx].trim());
      if (startMatch === null || endMatch === null) return null;
      const root = lines[startIdx + 1].trim();
      if (root === "") return null;
      const lineStarts = [0];
      for (let i = 0; i < text.length; i += 1) { if (text.charCodeAt(i) === 10) lineStarts.push(i + 1); }
      let manifest = "";
      const manifestLine = lines[startIdx + 4];
      if (typeof manifestLine === "string" && manifestLine.startsWith("Manifest: ")) manifest = manifestLine.slice("Manifest: ".length);
      const listIndex = lines.findIndex((l) => l.startsWith("Attached files"));
      if (listIndex === -1) return null;
      const files = [];
      const blockStart = lineStarts[startIdx];
      const blockEnd = lineStarts[endIdx] + endMatch[1].length;
      for (let idx = listIndex + 1; idx < endIdx; idx += 1) {
        const line = lines[idx];
        if (!line.startsWith("- ")) continue;
        const m = /^- "((?:[^"\\]|\\.)*)" \((\d+(?:\.\d+)? (?:B|KiB|MiB|GiB|TiB))\)(?:; original=("(?:[^"\\]|\\.)*"))?/.exec(line);
        if (m === null) continue;
        let original = undefined;
        if (m[3] !== undefined) { try { original = JSON.parse(m[3]); } catch { original = m[3]; } }
        files.push({ path: m[1], size: m[2], original });
      }
      if (files.length === 0) return null;
      return { root, manifest, files, blockStart, blockEnd, raw: text.slice(blockStart, blockEnd) };
    }

    function parseAttachmentBlocks(text) {
      const blocks = []; let cursor = 0;
      while (cursor < text.length) {
        const parsed = parseAttachmentBlock(text.slice(cursor));
        if (parsed === null) break;
        blocks.push({ root: parsed.root, manifest: parsed.manifest, files: parsed.files, blockStart: parsed.blockStart + cursor, blockEnd: parsed.blockEnd + cursor, raw: text.slice(parsed.blockStart + cursor, parsed.blockEnd + cursor) });
        cursor = parsed.blockEnd;
      }
      return blocks;
    }

    const warned = new Set();
    function foldAttachmentDiv(div) {
      const text = div.textContent ?? "";
      if (!text.includes(ATT_START_MARKER)) return;
      const blocks = parseAttachmentBlocks(text);
      if (blocks.length === 0) { if (!warned.has(div)) { warned.add(div); console.warn("dsh-image-read: fold skipped (parse failed):", text.slice(0, 300)); } return; }
      if (div.dataset.pasteFolded === undefined) div.dataset.pasteFolded = "1";
      if (div.dataset.pasteId === undefined) div.dataset.pasteId = attId();
      const pasteId = div.dataset.pasteId;
      if (div.parentElement !== null) {
        const existing = div.parentElement.querySelector('[data-paste-folded="container"][data-for="' + pasteId + '"]');
        if (existing !== null) return;
      }
      const wrap = document.createElement("div");
      wrap.className = "dshca-chat-attachments";
      wrap.dataset.pasteFolded = "container";
      wrap.dataset.for = pasteId;
      let pos = 0;
      for (const block of blocks) {
        const before = text.slice(pos, block.blockStart).trim();
        if (before !== "") { const words = document.createElement("div"); words.className = "dshca-chat-usertext"; words.textContent = before; wrap.appendChild(words); }
        for (const file of block.files) {
          const chip = document.createElement("div"); chip.className = "dshca-chat-chip";
          const icon = document.createElement("span"); icon.className = "dshca-chat-chip-icon"; icon.setAttribute("aria-hidden", "true");
          icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M5.2 8.6 9.8 4a2.1 2.1 0 1 1 3 3l-5.9 5.9a3.4 3.4 0 0 1-4.8-4.8l6-6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
          const name = document.createElement("span"); name.className = "dshca-chat-chip-name"; name.textContent = file.path;
          const meta = document.createElement("span"); meta.className = "dshca-chat-chip-meta"; meta.textContent = file.size;
          const absolute = block.root + "/" + file.path;
          const tip = document.createElement("div"); tip.className = "dshca-chat-tip";
          const tipLines = [];
          if (block.raw !== undefined) { tipLines.push(block.raw); if (file.original !== undefined && file.original !== file.path) tipLines.push("原始：" + file.original); tipLines.push("点击复制完整路径"); }
          else { tipLines.push(file.path, "大小：" + file.size, "位置：" + absolute); if (block.manifest !== "") tipLines.push("清单：" + block.manifest); if (file.original !== undefined && file.original !== file.path) tipLines.push("原始：" + file.original); tipLines.push("点击复制完整路径"); }
          tip.textContent = tipLines.join("\n");
          chip.appendChild(icon); chip.appendChild(name); chip.appendChild(meta); chip.appendChild(tip);
          chip.addEventListener("click", () => { navigator.clipboard?.writeText(absolute).then(() => showToast("已复制路径：" + absolute), () => showToast("复制失败：" + absolute)); });
          wrap.appendChild(chip);
        }
        pos = block.blockEnd;
      }
      const after = text.slice(pos).trim();
      if (after !== "") { const words = document.createElement("div"); words.className = "dshca-chat-usertext"; words.textContent = after; wrap.appendChild(words); }
      div.parentElement?.insertBefore(wrap, div.nextSibling);
    }

    function foldScan() {
      for (const wrap of document.querySelectorAll('[data-paste-folded="container"]')) {
        const owner = wrap.dataset.for;
        if (owner === undefined) { wrap.remove(); continue; }
        if (document.querySelector('[data-paste-id="' + owner + '"]') === null) wrap.remove();
      }
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const seen = new Set();
      let node;
      while ((node = walker.nextNode()) !== null) {
        const text = node.textContent ?? "";
        if (!text.includes("DSH_IMAGE_READ_ATTACHMENT")) continue;
        const container = node.parentElement;
        if (container === null || seen.has(container)) continue;
        if (container.closest('[data-paste-folded="container"]') !== null) continue;
        seen.add(container);
        if (container.dataset.pasteFolded !== undefined) { try { foldAttachmentDiv(container); } catch { /* best-effort */ } continue; }
        try { foldAttachmentDiv(container); } catch (c) { console.warn("dsh-image-read fold failed:", c); }
      }
    }

    // ════════════════════════════════════════════════════════════════════
    //  Language packs
    // ════════════════════════════════════════════════════════════════════

    const en = {
      imageReadTitle: "Image Read",
      imageReadDescription: "Vision API providers and limits.",
      apiKey: "API Key",
      apiKeyHint: "Stored outside the settings file. Leave blank to keep the current key.",
      apiKeySet: "A key is configured.",
      apiKeyUnset: "No key configured; image reading is unavailable until one is.",
      baseUrl: "Endpoint",
      baseUrlHint: "Overrides the primary provider endpoint; leave blank to keep the provider chain. /chat/completions is appended when missing.",
      model: "Model",
      modelHint: "Overrides the primary provider model; leave blank to keep the provider chain.",
      timeoutMs: "Request timeout (ms)",
      timeoutMsHint: "How long a vision request may run before it is terminated.",
      maxImageDimension: "Max image dimension (px)",
      maxImageDimensionHint: "Larger images are automatically downscaled.",
      overridden: "Overridden",
      reset: "Reset to default",
      readOnly: "This deployment stores settings read-only.",
      expand: "Show settings",
      collapse: "Hide settings",
      save: "Save",
      saving: "Saving…",
      discard: "Discard",
      unsaved: "Unsaved",
      saveFailed: "The deployment did not accept these values; they were left for you to correct.",
      invalidNumber: "Enter a number, or leave blank to use the default.",
    };

    const zh = {
      imageReadTitle: "图像识别",
      imageReadDescription: "视觉 API 提供方与限制。",
      apiKey: "API Key",
      apiKeyHint: "不写入设置文件。留空表示保持当前密钥。",
      apiKeySet: "已配置密钥。",
      apiKeyUnset: "未配置密钥；配置之前图像识别不可用。",
      baseUrl: "接口地址",
      baseUrlHint: "覆盖主 provider 的接口地址；留空保持 provider 链配置。未带 /chat/completions 时会自动补全。",
      model: "模型",
      modelHint: "覆盖主 provider 的模型名；留空保持 provider 链配置。",
      timeoutMs: "请求超时（毫秒）",
      timeoutMsHint: "视觉请求最长运行时间，超时即终止。",
      maxImageDimension: "最大图像边长（像素）",
      maxImageDimensionHint: "超过会自动缩小。",
      overridden: "已覆盖",
      reset: "恢复默认",
      readOnly: "本部署的设置为只读。",
      expand: "展开设置",
      collapse: "收起设置",
      save: "保存",
      saving: "保存中…",
      discard: "放弃修改",
      unsaved: "未保存",
      saveFailed: "本部署没有接受这些值，已保留供你修改。",
      invalidNumber: "请填数字；留空表示使用默认值。",
    };

    // ════════════════════════════════════════════════════════════════════
    //  Plugin entry — applies both A (vision) and B (attachment)
    // ════════════════════════════════════════════════════════════════════

    const pluginInject = ["slots", "locale", "connection", "remote", "settingsScope", "conversation", "sessions", "inputTriggers"];
    const pluginName = "dsh-image-read";

    function apply(ctx) {
      const { api } = ctx.get("connection");
      const t = ctx.locale.bind(IMAGE_READ_NS);

      // ── Locale ──────────────────────────────────────────────────────────
      ctx.effect(() => ctx.locale.register(IMAGE_READ_NS, { zh, en }), "image-read: locale");

      // ── A. Vision config card ─────────────────────────────────────────
      const scope = ctx.settingsScope.bind({ namespace: IMAGE_READ_NS });
      const controller = new ImageReadCardController(scope, api);

      ctx.effect(() => ctx.remote.$on("credentials/updated", (ref) => { controller.refreshCredential(ref); }), "image-read: credential invalidations");
      ctx.effect(() => ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({ name: "settings.plugin.item", key: IMAGE_READ_NS, locale: IMAGE_READ_NS, inject: () => controller.inject() }, ImageReadCard)), "image-read: config card");

      // ── B. Attachment input ────────────────────────────────────────────
      const sessions = ctx.get("sessions");
      const conversation = ctx.get("conversation");
      const inputTriggers = ctx.get("inputTriggers");

      // Bubble folding observer
      let foldTimer = null;
      const chatObserver = new MutationObserver(() => {
        if (foldTimer !== null) return;
        foldTimer = setTimeout(() => { foldTimer = null; try { foldScan(); } catch { /* best-effort */ } }, 120);
      });
      try {
        if (document.body !== null) {
          const boot = globalThis.__DSH_BOOT__;
          const self = boot?.entries?.find((e) => e.id === "dsh-image-read");
          document.body.dataset.imageReadAttachRev = self?.rev ?? "unknown";
        }
        chatObserver.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["style", "class", "data-paste-folded"] });
      } catch (c) { console.warn("dsh-image-read: observer setup failed:", c); }
      const sweep = setInterval(() => { try { foldScan(); } catch { /* best-effort */ } }, 2000);
      try { foldScan(); } catch (c) { console.warn("dsh-image-read: initial fold failed:", c); }
      ctx.effect(() => () => { chatObserver.disconnect(); clearInterval(sweep); if (foldTimer !== null) clearTimeout(foldTimer); }, "image-read: bubble fold observer");

      // inputTriggers source (attachment codec)
      const source = {
        trigger: "@", name: ATT_SOURCE, order: 1000,
        candidates: () => Promise.resolve([]),
        onPick: () => undefined,
        codec: {
          clipboardText: (ref) => records.get(ref)?.label ?? `attachment:${ref}`,
          serialize: (ref, signal) => { const rec = records.get(ref); if (rec === undefined) return Promise.reject(new Error("Attachment selection is no longer available in this browser tab")); return upload(rec, signal); },
        },
      };
      ctx.effect(() => inputTriggers.registerSource(source), "image-read: attachment codec");

      // Paste interception — capture phase is mandatory: the native composer's
      // delegated onPaste (React root, bubble) runs before a document bubble
      // listener and would ingest the same files as native image attachments,
      // which blocks submit on non-vision models (MODEL_DOES_NOT_SUPPORT_IMAGES).
      const onPaste = (event) => {
        const files = [...(event.clipboardData?.files ?? [])];
        if (files.length === 0) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const proceed = () => {
          const sessionId = sessions.list?.getSnapshot()?.current;
          if (sessionId === undefined) { showToast("请先打开一个会话。"); return; }
          let items; try { items = filesFromList(files); } catch (c) { showToast(c instanceof Error ? c.message : String(c)); return; }
          attAdd(sessionId, items).catch((c) => showToast(c instanceof Error ? c.message : String(c)));
        };
        if (noticeDismissed) proceed(); else showPasteNotice(proceed, () => {});
      };
      document.addEventListener("paste", onPaste, true);
      ctx.effect(() => () => document.removeEventListener("paste", onPaste, true), "image-read: paste listener");

      // Whole-page drop — capture phase for the same reason as paste: the native
      // composer listens on document (bubble) and would attach the files natively.
      const dragHasFiles = (event) => (event.dataTransfer?.files?.length ?? 0) > 0 || [...(event.dataTransfer?.items ?? [])].some((i) => i.kind === "file");
      const onDragenter = (event) => { if (!dragHasFiles(event)) return; event.preventDefault(); event.stopImmediatePropagation(); };
      const onDragover = (event) => { if (!dragHasFiles(event)) return; event.preventDefault(); event.stopImmediatePropagation(); if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "copy"; };
      const onDrop = (event) => {
        const hasFiles = dragHasFiles(event);
        if (!hasFiles) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const sessionId = sessions.list?.getSnapshot()?.current;
        if (sessionId === undefined) { showToast("请先打开一个会话。"); return; }
        filesFromDrop(event.dataTransfer).then((items) => attAdd(sessionId, items).catch((c) => showToast(c instanceof Error ? c.message : String(c))), (c) => showToast(c instanceof Error ? c.message : String(c)));
      };
      document.addEventListener("dragenter", onDragenter, true);
      document.addEventListener("dragover", onDragover, true);
      document.addEventListener("drop", onDrop, true);
      ctx.effect(() => () => { document.removeEventListener("dragenter", onDragenter, true); document.removeEventListener("dragover", onDragover, true); document.removeEventListener("drop", onDrop, true); }, "image-read: page drop listener");

      const inputFor = (sessionId) => {
        const actx = sessions.scope(sessionId);
        if (actx === undefined) throw new Error(`Attachment session is not active: ${sessionId}`);
        return conversation.input.for(actx);
      };

      const attAdd = async (sessionId, items) => {
        validateItems(items);
        const input = inputFor(sessionId);
        let snapshot = input.state.getSnapshot();
        if (snapshot.phase !== "plain") throw new Error("Wait for the current input operation to finish");
        if (snapshot.draft !== "" && !/\s$/u.test(snapshot.draft)) { input.setDraft(`${snapshot.draft} `); snapshot = input.state.getSnapshot(); }
        for (const item of items) {
          const ref = attId();
          const label = item.path;
          const record = { ref, sessionId, items: [item], total: item.file.size, label, status: "ready", uploaded: 0 };
          records.set(ref, record);
          const accepted = input.insertReference({ source: ATT_SOURCE, ref, label: compactReferenceLabel(label), clipboardText: `[attachment: ${label}]` }, { start: snapshot.draft.length, end: snapshot.draft.length, draftRev: snapshot.draftRev });
          if (!accepted) { records.delete(ref); throw new Error("The DSH composer changed before the attachment could be inserted"); }
          snapshot = input.state.getSnapshot();
          if (typeof input.state.subscribe === "function") {
            const unsubscribe = input.state.subscribe(() => {
              const cur = input.state.getSnapshot();
              const alive = cur.occurrences.some((o) => o.source === ATT_SOURCE && o.ref === ref);
              if (alive || record.inflight !== undefined) return;
              unsubscribe(); records.delete(ref); attChanged();
            });
          }
        }
        attChanged();
      };

      const attRemove = (sessionId, occurrence) => {
        const input = inputFor(sessionId);
        const snapshot = input.state.getSnapshot();
        if (snapshot.phase !== "plain") return;
        input.setDraft(snapshot.draft.slice(0, occurrence.offset) + snapshot.draft.slice(occurrence.offset + 1));
        records.delete(occurrence.ref);
        attChanged();
      };

      ctx.inject(["slots", "conversation", "sessions", "inputTriggers"], (scope) => {
        scope.slots.inject("conversation.input.left", () => scope.slots.register({ name: "conversation.input.left", id: "dsh-image-read-attach-btn", order: -100, inject: (sessionId) => ({ add: (items) => attAdd(sessionId, items) }) }, AttachButton));
        scope.slots.inject("conversation.input.dock", () => scope.slots.register({ name: "conversation.input.dock", id: "dsh-image-read-dock", order: 5, inject: (sessionId) => ({ remove: (occ) => attRemove(sessionId, occ) }) }, AttachmentDock));
        scope.slots.inject("settings.section", () => scope.slots.register({ name: "settings.section", id: "attachments", order: 20, label: () => attachmentCopy().nav, inject: () => ({ sessions }) }, AttachmentSettings));
      });

      // Debug hook
      if (typeof window !== "undefined") {
        window.__dshImageRead = {
          get configured() { return controller.credential.configured; },
        };
      }
    }

    exports.apply = apply;
    exports.inject = pluginInject;
    exports.name = pluginName;
    return module.exports;
  },
});
