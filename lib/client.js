(() => {
  window.__ModuleLoader__.load({
    id: "dsh-image-read",
    factory: (require2) => {
      var module = { exports: {} };
      var exports = module.exports;
      Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
      if (typeof window !== "undefined" && !window.__DSH_IMAGE_READ_BANNER__) {
        window.__DSH_IMAGE_READ_BANNER__ = true;
        console.log(
          "%c dsh-image-read %c v0.5.0 %c \u56FE\u50CF\u8BC6\u522B ",
          "background:#4d6bfe;color:#fff;font-weight:600;padding:2px 6px;border-radius:4px 0 0 4px;",
          "background:#2b2d31;color:#fff;padding:2px 6px;",
          "background:#f3f4f6;color:#374151;border-radius:0 4px 4px 0;padding:2px 6px;"
        );
      }
      const react = require2("react");
      const h = react.createElement;
      const { jsx, jsxs } = require2("react/jsx-runtime");
      const { createSnapshotStore } = require2("@deepseek-ai/dsh-client-runtime/client");
      const { IconChevronDownOutline14 } = require2("@deepseek-ai/dsh-client-ui-primitives");
      const clsx = (...args) => {
        let out = "";
        for (const a of args) {
          if (!a) continue;
          if (typeof a === "string" || typeof a === "number") out += a + " ";
          else if (Array.isArray(a)) out += clsx(...a) + " ";
          else if (typeof a === "object") {
            for (const k in a) if (a[k]) out += k + " ";
          }
        }
        return out.trim();
      };
      const IMAGE_READ_NS = "image-read";
      const API_KEY_FIELD = "apiKey";
      const DEFAULT_API_KEY_REF = "MIMO_API_KEY";
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
      if (typeof document !== "undefined") {
        if (!document.querySelector('style[data-plugin="dsh-image-read-ui"]')) {
          const tag = document.createElement("style");
          tag.dataset.plugin = "dsh-image-read-ui";
          tag.textContent = CSS_IMGREAD;
          document.head.appendChild(tag);
        }
      }
      const C = {
        field: "imgread-field",
        head: "imgread-head",
        label: "imgread-label",
        input: "imgread-input",
        inputInvalid: "imgread-inputInvalid",
        invalid: "imgread-invalid",
        hint: "imgread-hint",
        badges: "imgread-badges",
        badge: "imgread-badge",
        badgeMuted: "imgread-badgeMuted",
        reset: "imgread-reset",
        card: "imgread-card",
        cardOpen: "imgread-cardOpen",
        header: "imgread-header",
        headText: "imgread-headText",
        name: "imgread-name",
        desc: "imgread-desc",
        chevron: "imgread-chevron",
        chevronOpen: "imgread-chevronOpen",
        body: "imgread-body",
        readOnly: "imgread-readOnly",
        pending: "imgread-pending",
        footer: "imgread-footer",
        failed: "imgread-failed",
        discard: "imgread-discard",
        save: "imgread-save"
      };
      function numberField(field) {
        return {
          field,
          format: (v) => typeof v === "number" ? String(v) : "",
          parse: (t) => {
            const s = t.trim();
            if (s === "") return { kind: "clear" };
            const n = Number(s);
            return Number.isFinite(n) ? { kind: "set", value: n } : void 0;
          }
        };
      }
      function textField(field) {
        return {
          field,
          format: (v) => typeof v === "string" ? v : "",
          parse: (t) => {
            const s = t.trim();
            if (s === "") return { kind: "clear" };
            return { kind: "set", value: s };
          }
        };
      }
      class CardForm {
        constructor(scope, specs, secrets = []) {
          this.scope = scope;
          this.specs = new Map(specs.map((s) => [s.field, s]));
          this.secretSpecs = new Map(secrets.map((s) => [s.field, s]));
          this.staged = /* @__PURE__ */ new Map();
          this.listeners = /* @__PURE__ */ new Set();
          this.saving = false;
          this.failed = false;
          scope.subscribe(() => this.publish());
        }
        bind(project) {
          const store = createSnapshotStore(project());
          this.listeners.add(() => store.set(project()));
          return store;
        }
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
            discard: () => {
              if (this.staged.size === 0 && !this.failed) return;
              this.staged.clear();
              this.failed = false;
              this.publish();
            }
          };
        }
        async save() {
          const plan = this.plan();
          const writes = plan.flatMap((i) => i.run === void 0 ? [] : [i.run]);
          if (plan.length === 0 || this.saving || writes.length !== plan.length) return;
          this.saving = true;
          this.failed = false;
          this.publish();
          let ok = true;
          for (const w of writes) ok = await w() && ok;
          if (ok) this.staged.clear();
          this.saving = false;
          this.failed = !ok;
          this.publish();
        }
        plan() {
          const plan = [];
          for (const [f, staged] of this.staged) {
            const secret = this.secretSpecs.get(f);
            if (secret !== void 0) {
              const v = staged.text.trim();
              if (v !== "") plan.push({ field: f, run: () => secret.write(v) });
              continue;
            }
            const spec = this.spec(f);
            if (staged.clear) {
              if (this.stored(f)) plan.push({ field: f, run: () => this.clear(f) });
              continue;
            }
            if (staged.text === spec.format(this.sectionValue(f))) continue;
            const write = spec.parse(staged.text);
            if (write === void 0) plan.push({ field: f, run: void 0 });
            else if (write.kind === "clear") plan.push({ field: f, run: () => this.clear(f) });
            else plan.push({ field: f, run: () => this.store(f, write.value) });
          }
          return plan;
        }
        async clear(f) {
          await this.scope.unset(f);
          return !this.stored(f);
        }
        async store(f, v) {
          await this.scope.set(f, v);
          return this.userLayer()?.[f] === v;
        }
        stage(f, e) {
          this.staged.set(f, e);
          this.failed = false;
          this.publish();
        }
        spec(f) {
          const s = this.specs.get(f);
          if (!s) throw new Error(`no field ${f}`);
          return s;
        }
        snapshotOf() {
          return this.scope.getSnapshot();
        }
        sectionValue(f) {
          return this.snapshotOf().value?.[f];
        }
        baseValue(f) {
          return this.snapshotOf().base?.[f];
        }
        userLayer() {
          return this.snapshotOf().user;
        }
        stored(f) {
          const u = this.userLayer();
          return u !== void 0 && Object.hasOwn(u, f);
        }
        publish() {
          for (const l of this.listeners) l();
        }
      }
      function ValueField(props) {
        return jsxs("div", { className: C.field, children: [
          jsxs("div", { className: C.head, children: [
            jsx("label", { className: C.label, htmlFor: props.id, children: props.label }),
            props.overridden ? jsxs("span", { className: C.badges, children: [jsx("span", { className: C.badge, children: props.overriddenLabel }), jsx("button", { type: "button", className: C.reset, disabled: props.disabled, onClick: props.onReset, children: props.resetLabel })] }) : null
          ] }),
          jsx("input", { id: props.id, className: props.invalid ? C.inputInvalid : C.input, type: "text", ...props.numeric === true ? { inputMode: "numeric" } : {}, ...props.invalid ? { "aria-invalid": true } : {}, value: props.text, placeholder: props.placeholder ?? "", disabled: props.disabled, onChange: (e) => props.onEdit(e.target.value) }),
          jsx("p", { className: props.invalid ? C.invalid : C.hint, children: props.invalid ? props.invalidLabel : props.hint })
        ] });
      }
      function SecretField(props) {
        return jsxs("div", { className: C.field, children: [
          jsxs("div", { className: C.head, children: [
            jsx("label", { className: C.label, htmlFor: props.id, children: props.label }),
            jsx("span", { className: C.badges, children: jsx("span", { className: props.configured ? C.badge : C.badgeMuted, children: props.stateLabel }) })
          ] }),
          jsx("input", { id: props.id, className: C.input, type: "password", autoComplete: "off", value: props.text, disabled: props.disabled, onChange: (e) => props.onEdit(e.target.value) }),
          jsx("p", { className: C.hint, children: props.hint })
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
            jsx(IconChevronDownOutline14, { className: clsx(C.chevron, open && C.chevronOpen) })
          ] }),
          open ? jsxs("div", { className: C.body, children: [
            !state.writable ? jsx("p", { className: C.readOnly, role: "status", children: props.t("readOnly") }) : null,
            props.children,
            jsxs("div", { className: C.footer, children: [
              state.failed ? jsx("p", { className: C.failed, role: "status", children: props.t("saveFailed") }) : null,
              jsx("button", { type: "button", className: C.discard, disabled: !state.dirty || state.saving, onClick: props.onDiscard, children: props.t("discard") }),
              jsx("button", { type: "button", className: C.save, disabled: blocked, onClick: props.onSave, children: props.t(state.saving ? "saving" : "save") })
            ] })
          ] }) : null
        ] });
      }
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
          if (ref !== this.credential.ref) {
            this.credential = { ref, configured: false, writable: true };
            this.store.set(this.projection());
          }
          let response;
          try {
            response = await this.api.credentials.describe({ refs: [ref] });
          } catch {
            return;
          }
          if (!response.result.ok || ref !== this.refOf(this.scope.getSnapshot())) return;
          const view = response.result.value.credentials[ref];
          const next = { ref, configured: view?.configured ?? false, writable: view?.writable ?? true };
          if (next.configured === this.credential.configured && next.writable === this.credential.writable) return;
          this.credential = next;
          this.store.set(this.projection());
        }
        refreshCredential(ref) {
          if (ref !== this.credential.ref) return;
          this.readCredential();
        }
        inject() {
          return { hooks: { imageReadCard: this.store }, ...this.form.actions() };
        }
        async writeKey(value) {
          try {
            await this.api.credentials.set({ ref: this.refOf(this.scope.getSnapshot()), value });
          } catch {
          }
          await this.readCredential();
          return this.credential.configured;
        }
        refOf(snapshot) {
          const providers = snapshot.value?.providers;
          if (Array.isArray(providers) && providers.length > 0 && providers[0].name) return `IMAGE_READ_${providers[0].name.toUpperCase()}_API_KEY`;
          return DEFAULT_API_KEY_REF;
        }
      }
      function ImageReadCard(props) {
        const { t } = props;
        const state = props.useImageReadCard((s) => s);
        const disabled = !state.writable;
        return jsxs(PluginCard, {
          t,
          titleKey: "imageReadTitle",
          descriptionKey: "imageReadDescription",
          state,
          onSave: props.save,
          onDiscard: props.discard,
          children: [
            jsx(ValueField, { id: "imgread-baseurl", label: t("baseUrl"), hint: t("baseUrlHint"), overriddenLabel: t("overridden"), resetLabel: t("reset"), disabled, ...state.baseUrl, onEdit: (t2) => props.edit("baseUrl", t2), onReset: () => props.resetField("baseUrl") }),
            jsx(ValueField, { id: "imgread-model", label: t("model"), hint: t("modelHint"), overriddenLabel: t("overridden"), resetLabel: t("reset"), disabled, ...state.model, onEdit: (t2) => props.edit("model", t2), onReset: () => props.resetField("model") }),
            jsx(SecretField, { id: "imgread-apikey", label: t("apiKey"), hint: t("apiKeyHint"), disabled: !state.apiKeyWritable, text: state.apiKey.text, configured: state.apiKeyConfigured, stateLabel: state.apiKeyConfigured ? t("apiKeySet") : t("apiKeyUnset"), onEdit: (t2) => props.edit("apiKey", t2) }),
            jsx(ValueField, { id: "imgread-timeout", label: t("timeoutMs"), hint: t("timeoutMsHint"), overriddenLabel: t("overridden"), resetLabel: t("reset"), invalidLabel: t("invalidNumber"), numeric: true, disabled, ...state.timeoutMs, onEdit: (t2) => props.edit("timeoutMs", t2), onReset: () => props.resetField("timeoutMs") }),
            jsx(ValueField, { id: "imgread-maxdim", label: t("maxImageDimension"), hint: t("maxImageDimensionHint"), overriddenLabel: t("overridden"), resetLabel: t("reset"), invalidLabel: t("invalidNumber"), numeric: true, disabled, ...state.maxImageDimension, onEdit: (t2) => props.edit("maxImageDimension", t2), onReset: () => props.resetField("maxImageDimension") })
          ]
        });
      }
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
        saving: "Saving\u2026",
        discard: "Discard",
        unsaved: "Unsaved",
        saveFailed: "The deployment did not accept these values; they were left for you to correct.",
        invalidNumber: "Enter a number, or leave blank to use the default."
      };
      const zh = {
        imageReadTitle: "\u56FE\u50CF\u8BC6\u522B",
        imageReadDescription: "\u89C6\u89C9 API \u63D0\u4F9B\u65B9\u4E0E\u9650\u5236\u3002",
        apiKey: "API Key",
        apiKeyHint: "\u4E0D\u5199\u5165\u8BBE\u7F6E\u6587\u4EF6\u3002\u7559\u7A7A\u8868\u793A\u4FDD\u6301\u5F53\u524D\u5BC6\u94A5\u3002",
        apiKeySet: "\u5DF2\u914D\u7F6E\u5BC6\u94A5\u3002",
        apiKeyUnset: "\u672A\u914D\u7F6E\u5BC6\u94A5\uFF1B\u914D\u7F6E\u4E4B\u524D\u56FE\u50CF\u8BC6\u522B\u4E0D\u53EF\u7528\u3002",
        baseUrl: "\u63A5\u53E3\u5730\u5740",
        baseUrlHint: "\u8986\u76D6\u4E3B provider \u7684\u63A5\u53E3\u5730\u5740\uFF1B\u7559\u7A7A\u4FDD\u6301 provider \u94FE\u914D\u7F6E\u3002\u672A\u5E26 /chat/completions \u65F6\u4F1A\u81EA\u52A8\u8865\u5168\u3002",
        model: "\u6A21\u578B",
        modelHint: "\u8986\u76D6\u4E3B provider \u7684\u6A21\u578B\u540D\uFF1B\u7559\u7A7A\u4FDD\u6301 provider \u94FE\u914D\u7F6E\u3002",
        timeoutMs: "\u8BF7\u6C42\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09",
        timeoutMsHint: "\u89C6\u89C9\u8BF7\u6C42\u6700\u957F\u8FD0\u884C\u65F6\u95F4\uFF0C\u8D85\u65F6\u5373\u7EC8\u6B62\u3002",
        maxImageDimension: "\u6700\u5927\u56FE\u50CF\u8FB9\u957F\uFF08\u50CF\u7D20\uFF09",
        maxImageDimensionHint: "\u8D85\u8FC7\u4F1A\u81EA\u52A8\u7F29\u5C0F\u3002",
        overridden: "\u5DF2\u8986\u76D6",
        reset: "\u6062\u590D\u9ED8\u8BA4",
        readOnly: "\u672C\u90E8\u7F72\u7684\u8BBE\u7F6E\u4E3A\u53EA\u8BFB\u3002",
        expand: "\u5C55\u5F00\u8BBE\u7F6E",
        collapse: "\u6536\u8D77\u8BBE\u7F6E",
        save: "\u4FDD\u5B58",
        saving: "\u4FDD\u5B58\u4E2D\u2026",
        discard: "\u653E\u5F03\u4FEE\u6539",
        unsaved: "\u672A\u4FDD\u5B58",
        saveFailed: "\u672C\u90E8\u7F72\u6CA1\u6709\u63A5\u53D7\u8FD9\u4E9B\u503C\uFF0C\u5DF2\u4FDD\u7559\u4F9B\u4F60\u4FEE\u6539\u3002",
        invalidNumber: "\u8BF7\u586B\u6570\u5B57\uFF1B\u7559\u7A7A\u8868\u793A\u4F7F\u7528\u9ED8\u8BA4\u503C\u3002"
      };
      const pluginInject = ["slots", "locale", "connection", "remote", "settingsScope"];
      const pluginName = "dsh-image-read";
      function apply(ctx) {
        const { api } = ctx.get("connection");
        const t = ctx.locale.bind(IMAGE_READ_NS);
        ctx.effect(() => ctx.locale.register(IMAGE_READ_NS, { zh, en }), "image-read: locale");
        const scope = ctx.settingsScope.bind({ namespace: IMAGE_READ_NS });
        const controller = new ImageReadCardController(scope, api);
        ctx.effect(() => ctx.remote.$on("credentials/updated", (ref) => {
          controller.refreshCredential(ref);
        }), "image-read: credential invalidations");
        ctx.effect(() => ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({ name: "settings.plugin.item", key: IMAGE_READ_NS, locale: IMAGE_READ_NS, inject: () => controller.inject() }, ImageReadCard)), "image-read: config card");
        if (typeof window !== "undefined") {
          window.__dshImageRead = {
            get configured() {
              return controller.credential.configured;
            }
          };
        }
      }
      exports.apply = apply;
      exports.inject = pluginInject;
      exports.name = pluginName;
      return module.exports;
    }
  });
})();
