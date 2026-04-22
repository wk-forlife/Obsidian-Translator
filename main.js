var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => PdfNiuTransAutoTranslatorPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  apiUrl: "https://api.niutrans.com/v2/text/translate",
  apiKey: "",
  appId: "",
  sourceLang: "en",
  targetLang: "zh",
  autoTranslateDelayMs: 350,
  requestTimeoutMs: 15e3
};
var PdfNiuTransAutoTranslatorPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.currentSelection = null;
    this.refreshTimer = null;
    this.translateTimer = null;
    this.requestSequence = 0;
  }
  async onload() {
    await this.loadSettings();
    this.panel = new TranslationPanel();
    this.register(() => this.panel.destroy());
    this.addSettingTab(new PdfNiuTransSettingTab(this.app, this));
    this.registerDomEvent(document, "selectionchange", () => this.scheduleRefresh(60));
    this.registerDomEvent(document, "mouseup", () => this.scheduleRefresh(30));
    this.registerDomEvent(document, "keyup", () => this.scheduleRefresh(30));
    this.registerDomEvent(document, "scroll", () => this.scheduleRefresh(60), true);
    this.registerDomEvent(window, "resize", () => this.scheduleRefresh(60));
    this.registerDomEvent(document, "pointerdown", (event) => this.handlePointerDown(event), true);
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.refreshSelection()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.scheduleRefresh(60)));
  }
  onunload() {
    this.clearRefreshTimer();
    this.clearTranslateTimer();
  }
  async loadSettings() {
    this.settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      ...await this.loadData()
    });
  }
  async saveSettings() {
    this.settings = normalizeSettings(this.settings);
    await this.saveData(this.settings);
  }
  scheduleRefresh(delayMs) {
    this.clearRefreshTimer();
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      this.refreshSelection();
    }, delayMs);
  }
  clearRefreshTimer() {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
  clearTranslateTimer() {
    if (this.translateTimer !== null) {
      window.clearTimeout(this.translateTimer);
      this.translateTimer = null;
    }
  }
  handlePointerDown(event) {
    const target = event.target;
    if (target == null ? void 0 : target.closest(".pdf-niutrans-panel")) {
      return;
    }
    if (!target || !this.isInsidePdfView(target)) {
      this.resetSelection();
    }
  }
  isInsidePdfView(target) {
    const view = this.getActiveView();
    return Boolean(view && view.getViewType() === "pdf" && view.containerEl.contains(target));
  }
  refreshSelection() {
    var _a, _b;
    const snapshot = this.readPdfSelection();
    if (!snapshot) {
      this.resetSelection();
      return;
    }
    const previousKey = (_b = (_a = this.currentSelection) == null ? void 0 : _a.key) != null ? _b : null;
    this.currentSelection = snapshot;
    if (previousKey === snapshot.key) {
      this.panel.updateAnchor(snapshot.anchorRect);
      return;
    }
    this.panel.showLoading(snapshot.anchorRect, "Translating selection...");
    this.scheduleTranslation(snapshot);
  }
  resetSelection() {
    this.currentSelection = null;
    this.clearTranslateTimer();
    this.panel.hide();
  }
  scheduleTranslation(snapshot) {
    this.clearTranslateTimer();
    this.translateTimer = window.setTimeout(() => {
      var _a;
      this.translateTimer = null;
      if (((_a = this.currentSelection) == null ? void 0 : _a.key) !== snapshot.key) {
        return;
      }
      void this.translateSelection(snapshot);
    }, this.settings.autoTranslateDelayMs);
  }
  readPdfSelection() {
    var _a;
    const view = this.getActiveView();
    if (!view || view.getViewType() !== "pdf") {
      return null;
    }
    const selection = window.getSelection();
    const text = (_a = selection == null ? void 0 : selection.toString()) != null ? _a : "";
    if (!selection || selection.rangeCount === 0 || !text.trim()) {
      return null;
    }
    const range = selection.getRangeAt(0);
    if (!view.containerEl.contains(range.commonAncestorContainer)) {
      return null;
    }
    const anchorRect = getAnchorRect(range);
    if (!anchorRect) {
      return null;
    }
    return {
      key: buildSelectionKey(text, anchorRect),
      text: text.trim(),
      anchorRect
    };
  }
  getActiveView() {
    var _a, _b;
    return (_b = (_a = this.app.workspace.activeLeaf) == null ? void 0 : _a.view) != null ? _b : null;
  }
  async translateSelection(snapshot) {
    if (snapshot.text.length > 2e3) {
      this.panel.showError(snapshot.anchorRect, "\u9009\u4E2D\u6587\u672C\u8FC7\u957F\uFF0C\u8BF7\u63A7\u5236\u5728 2000 \u5B57\u7B26\u4EE5\u5185\u3002");
      return;
    }
    if (!this.settings.apiUrl.trim()) {
      this.panel.showError(snapshot.anchorRect, "\u8BF7\u5148\u5728\u8BBE\u7F6E\u4E2D\u586B\u5199\u5C0F\u725B\u7FFB\u8BD1\u63A5\u53E3\u5730\u5740\u3002");
      return;
    }
    if (!this.settings.apiKey.trim()) {
      this.panel.showError(snapshot.anchorRect, "\u8BF7\u5148\u5728\u8BBE\u7F6E\u4E2D\u586B\u5199 API Key\u3002");
      return;
    }
    if (!this.settings.appId.trim()) {
      this.panel.showError(snapshot.anchorRect, "\u8BF7\u5148\u5728\u8BBE\u7F6E\u4E2D\u586B\u5199 App ID\u3002");
      return;
    }
    if (this.settings.sourceLang !== "auto" && this.settings.sourceLang === this.settings.targetLang) {
      this.panel.showError(snapshot.anchorRect, "\u6E90\u8BED\u8A00\u548C\u76EE\u6807\u8BED\u8A00\u4E0D\u80FD\u76F8\u540C\u3002");
      return;
    }
    const requestId = ++this.requestSequence;
    this.panel.showLoading(snapshot.anchorRect, "Translating selection...");
    try {
      const result = await this.requestTranslation(snapshot.text);
      if (!this.isCurrentRequest(snapshot.key, requestId)) {
        return;
      }
      this.panel.showResult(snapshot.anchorRect, result.translation);
    } catch (error) {
      if (!this.isCurrentRequest(snapshot.key, requestId)) {
        return;
      }
      const message = error instanceof Error ? error.message : "\u7FFB\u8BD1\u5931\u8D25";
      this.panel.showError(snapshot.anchorRect, message);
    }
  }
  isCurrentRequest(selectionKey, requestId) {
    var _a;
    return ((_a = this.currentSelection) == null ? void 0 : _a.key) === selectionKey && requestId === this.requestSequence;
  }
  async requestTranslation(text) {
    var _a, _b;
    const timestamp = Number((0, import_obsidian.moment)().format("X"));
    const payload = {
      from: this.settings.sourceLang,
      to: this.settings.targetLang,
      srcText: text,
      appId: this.settings.appId.trim(),
      timestamp
    };
    const authStr = createAuthStr(payload, this.settings.apiKey.trim());
    const response = await withTimeout(
      (0, import_obsidian.requestUrl)({
        url: this.settings.apiUrl.trim(),
        method: "POST",
        contentType: "application/json",
        body: JSON.stringify({
          ...payload,
          authStr
        }),
        throw: false
      }),
      this.settings.requestTimeoutMs,
      `\u7FFB\u8BD1\u8BF7\u6C42\u8D85\u65F6\uFF08>${this.settings.requestTimeoutMs}ms\uFF09`
    );
    const data = (_b = response.json) != null ? _b : tryParseJson((_a = response.text) != null ? _a : "");
    const translation = extractTranslation(data);
    if (response.status >= 400) {
      throw new Error(extractErrorMessage(data) || `\u7FFB\u8BD1\u8BF7\u6C42\u5931\u8D25\uFF08HTTP ${response.status}\uFF09`);
    }
    if (!translation) {
      throw new Error(extractErrorMessage(data) || "\u63A5\u53E3\u8FD4\u56DE\u91CC\u6CA1\u6709\u627E\u5230\u8BD1\u6587\u3002");
    }
    return {
      translation,
      raw: data
    };
  }
};
var TranslationPanel = class {
  constructor() {
    this.rootEl = document.createElement("div");
    this.rootEl.className = "pdf-niutrans-panel";
    const headerEl = document.createElement("div");
    headerEl.className = "pdf-niutrans-panel__header";
    const titleEl = document.createElement("div");
    titleEl.className = "pdf-niutrans-panel__title";
    titleEl.textContent = "PDF Auto Translation";
    const closeButtonEl = document.createElement("button");
    closeButtonEl.type = "button";
    closeButtonEl.className = "pdf-niutrans-panel__close";
    closeButtonEl.textContent = "\xD7";
    closeButtonEl.addEventListener("click", () => this.hide());
    headerEl.append(titleEl, closeButtonEl);
    this.statusEl = document.createElement("p");
    this.statusEl.className = "pdf-niutrans-panel__status";
    this.contentEl = document.createElement("p");
    this.contentEl.className = "pdf-niutrans-panel__content";
    this.rootEl.append(headerEl, this.statusEl, this.contentEl);
    document.body.appendChild(this.rootEl);
  }
  destroy() {
    this.rootEl.remove();
  }
  showLoading(anchorRect, status) {
    this.rootEl.classList.remove("is-error");
    this.statusEl.textContent = status;
    this.contentEl.textContent = "\u8BF7\u7A0D\u5019...";
    this.show(anchorRect);
  }
  showResult(anchorRect, text) {
    this.rootEl.classList.remove("is-error");
    this.statusEl.textContent = "";
    this.contentEl.textContent = text;
    this.show(anchorRect);
  }
  showError(anchorRect, message) {
    this.rootEl.classList.add("is-error");
    this.statusEl.textContent = "\u7FFB\u8BD1\u5931\u8D25";
    this.contentEl.textContent = message;
    this.show(anchorRect);
  }
  updateAnchor(anchorRect) {
    if (this.rootEl.classList.contains("is-visible")) {
      this.position(anchorRect);
    }
  }
  hide() {
    this.rootEl.classList.remove("is-visible", "is-error");
  }
  show(anchorRect) {
    this.rootEl.classList.add("is-visible");
    this.position(anchorRect);
  }
  position(anchorRect) {
    const margin = 12;
    const panelRect = this.rootEl.getBoundingClientRect();
    const panelWidth = panelRect.width || 420;
    const panelHeight = panelRect.height || 180;
    let left = anchorRect.right + 14;
    let top = anchorRect.bottom + 10;
    if (left + panelWidth > window.innerWidth - margin) {
      left = Math.max(margin, anchorRect.left - panelWidth - 14);
    }
    if (top + panelHeight > window.innerHeight - margin) {
      top = Math.max(margin, anchorRect.top - panelHeight - 10);
    }
    this.rootEl.style.left = `${clamp(left, margin, Math.max(margin, window.innerWidth - panelWidth - margin))}px`;
    this.rootEl.style.top = `${clamp(top, margin, Math.max(margin, window.innerHeight - panelHeight - margin))}px`;
  }
};
var PdfNiuTransSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "PDF NiuTrans Auto Translator" });
    containerEl.createEl("p", {
      text: "Only works in PDF views. Translation starts automatically after the selection becomes stable."
    });
    new import_obsidian.Setting(containerEl).setName("API URL").setDesc("Fill in the NiuTrans text translation endpoint.").addText(
      (text) => text.setPlaceholder("https://...your-niutrans-endpoint...").setValue(this.plugin.settings.apiUrl).onChange(async (value) => {
        this.plugin.settings.apiUrl = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("API Key").setDesc("Stored in this vault only.").addText((text) => {
      text.inputEl.type = "password";
      text.setValue(this.plugin.settings.apiKey).onChange(async (value) => {
        this.plugin.settings.apiKey = value.trim();
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian.Setting(containerEl).setName("App ID").setDesc("NiuTrans API application identifier.").addText(
      (text) => text.setPlaceholder("wPO...").setValue(this.plugin.settings.appId).onChange(async (value) => {
        this.plugin.settings.appId = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Source language").setDesc("Only supports auto, English, and Chinese in this minimal version.").addDropdown(
      (dropdown) => dropdown.addOption("auto", "Auto").addOption("en", "English").addOption("zh", "Chinese").setValue(this.plugin.settings.sourceLang).onChange(async (value) => {
        this.plugin.settings.sourceLang = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Target language").setDesc("Only supports English and Chinese in this minimal version.").addDropdown(
      (dropdown) => dropdown.addOption("zh", "Chinese").addOption("en", "English").setValue(this.plugin.settings.targetLang).onChange(async (value) => {
        this.plugin.settings.targetLang = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Auto translate delay").setDesc("Translation starts after the selection remains stable for this many milliseconds.").addText(
      (text) => text.setValue(String(this.plugin.settings.autoTranslateDelayMs)).onChange(async (value) => {
        this.plugin.settings.autoTranslateDelayMs = Number.parseInt(value, 10);
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Request timeout").setDesc("Client-side timeout in milliseconds.").addText(
      (text) => text.setValue(String(this.plugin.settings.requestTimeoutMs)).onChange(async (value) => {
        this.plugin.settings.requestTimeoutMs = Number.parseInt(value, 10);
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Test notice").setDesc("This only validates local settings, not the remote API.").addButton(
      (button) => button.setButtonText("Check settings").onClick(() => {
        const warnings = [];
        if (!this.plugin.settings.apiUrl.trim()) {
          warnings.push("API URL missing");
        }
        if (!this.plugin.settings.apiKey.trim()) {
          warnings.push("API Key missing");
        }
        if (!this.plugin.settings.appId.trim()) {
          warnings.push("App ID missing");
        }
        if (warnings.length > 0) {
          new import_obsidian.Notice(warnings.join(" / "));
          return;
        }
        new import_obsidian.Notice("Settings look usable.");
      })
    );
  }
};
function normalizeSettings(settings) {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i;
  const autoTranslateDelayMs = Number(settings.autoTranslateDelayMs);
  const requestTimeoutMs = Number(settings.requestTimeoutMs);
  return {
    apiUrl: (_c = (_b = (_a = settings.apiUrl) == null ? void 0 : _a.trim) == null ? void 0 : _b.call(_a)) != null ? _c : "",
    apiKey: (_f = (_e = (_d = settings.apiKey) == null ? void 0 : _d.trim) == null ? void 0 : _e.call(_d)) != null ? _f : "",
    appId: (_i = (_h = (_g = settings.appId) == null ? void 0 : _g.trim) == null ? void 0 : _h.call(_g)) != null ? _i : "",
    sourceLang: normalizeSourceLang(settings.sourceLang),
    targetLang: settings.targetLang === "en" ? "en" : "zh",
    autoTranslateDelayMs: Number.isFinite(autoTranslateDelayMs) ? clamp(autoTranslateDelayMs, 100, 2e3) : DEFAULT_SETTINGS.autoTranslateDelayMs,
    requestTimeoutMs: Number.isFinite(requestTimeoutMs) ? clamp(requestTimeoutMs, 1e3, 6e4) : DEFAULT_SETTINGS.requestTimeoutMs
  };
}
function normalizeSourceLang(value) {
  if (value === "auto" || value === "zh") {
    return value;
  }
  return "en";
}
function getAnchorRect(range) {
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 || rect.height > 0);
  if (rects.length === 0) {
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      return null;
    }
    return new DOMRect(rect.left, rect.top, Math.max(rect.width, 1), Math.max(rect.height, 1));
  }
  const anchorRect = rects.reduce((current, rect) => {
    if (rect.bottom > current.bottom + 0.5) {
      return rect;
    }
    if (Math.abs(rect.bottom - current.bottom) <= 0.5 && rect.right > current.right) {
      return rect;
    }
    return current;
  });
  return new DOMRect(anchorRect.left, anchorRect.top, Math.max(anchorRect.width, 1), Math.max(anchorRect.height, 1));
}
function buildSelectionKey(text, anchorRect) {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  return `${normalizedText}::${Math.round(anchorRect.left)}:${Math.round(anchorRect.top)}:${Math.round(anchorRect.width)}:${Math.round(anchorRect.height)}`;
}
function extractTranslation(data) {
  if (!data || typeof data !== "object") {
    return "";
  }
  const record = data;
  const directCandidates = [
    record.tgtText,
    record.tgt_text,
    record.translation,
    record.trans_result,
    record.target_text,
    record.data
  ];
  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  if (Array.isArray(record.tgt_text) && typeof record.tgt_text[0] === "string") {
    return record.tgt_text[0].trim();
  }
  return "";
}
function extractErrorMessage(data) {
  if (!data || typeof data !== "object") {
    return "";
  }
  const record = data;
  const candidates = [
    record.errorMsg,
    record.error_msg,
    record.msg,
    record.message,
    record.error
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  if (typeof record.error_code === "string" && record.error_code.trim()) {
    return `\u9519\u8BEF\u7801\uFF1A${record.error_code.trim()}`;
  }
  if (typeof record.errorCode === "string" && record.errorCode.trim()) {
    return `\u9519\u8BEF\u7801\uFF1A${record.errorCode.trim()}`;
  }
  return "";
}
function createAuthStr(payload, apiKey) {
  const signParams = {
    ...payload,
    apikey: apiKey
  };
  const paramStr = Object.keys(signParams).sort().filter((key) => signParams[key] !== "" && signParams[key] !== void 0 && signParams[key] !== null).map((key) => `${key}=${signParams[key]}`).join("&");
  return md5(paramStr);
}
function md5(input) {
  function rotateLeft(value, shift) {
    return value << shift | value >>> 32 - shift;
  }
  function addUnsigned(x2, y) {
    const x4 = x2 & 1073741824;
    const y4 = y & 1073741824;
    const x8 = x2 & 2147483648;
    const y8 = y & 2147483648;
    const result = (x2 & 1073741823) + (y & 1073741823);
    if (x4 & y4) {
      return result ^ 2147483648 ^ x8 ^ y8;
    }
    if (x4 | y4) {
      if (result & 1073741824) {
        return result ^ 3221225472 ^ x8 ^ y8;
      }
      return result ^ 1073741824 ^ x8 ^ y8;
    }
    return result ^ x8 ^ y8;
  }
  function f(x2, y, z) {
    return x2 & y | ~x2 & z;
  }
  function g(x2, y, z) {
    return x2 & z | y & ~z;
  }
  function h(x2, y, z) {
    return x2 ^ y ^ z;
  }
  function i(x2, y, z) {
    return y ^ (x2 | ~z);
  }
  function ff(a2, b2, c2, d2, x2, s, ac) {
    a2 = addUnsigned(a2, addUnsigned(addUnsigned(f(b2, c2, d2), x2), ac));
    return addUnsigned(rotateLeft(a2, s), b2);
  }
  function gg(a2, b2, c2, d2, x2, s, ac) {
    a2 = addUnsigned(a2, addUnsigned(addUnsigned(g(b2, c2, d2), x2), ac));
    return addUnsigned(rotateLeft(a2, s), b2);
  }
  function hh(a2, b2, c2, d2, x2, s, ac) {
    a2 = addUnsigned(a2, addUnsigned(addUnsigned(h(b2, c2, d2), x2), ac));
    return addUnsigned(rotateLeft(a2, s), b2);
  }
  function ii(a2, b2, c2, d2, x2, s, ac) {
    a2 = addUnsigned(a2, addUnsigned(addUnsigned(i(b2, c2, d2), x2), ac));
    return addUnsigned(rotateLeft(a2, s), b2);
  }
  function convertToWordArray(value) {
    const messageLength = value.length;
    const numberOfWordsTemp1 = messageLength + 8;
    const numberOfWordsTemp2 = (numberOfWordsTemp1 - numberOfWordsTemp1 % 64) / 64;
    const numberOfWords = (numberOfWordsTemp2 + 1) * 16;
    const wordArray = new Array(numberOfWords - 1);
    let bytePosition = 0;
    let byteCount = 0;
    while (byteCount < messageLength) {
      const wordCount2 = (byteCount - byteCount % 4) / 4;
      bytePosition = byteCount % 4 * 8;
      wordArray[wordCount2] = wordArray[wordCount2] | value.charCodeAt(byteCount) << bytePosition;
      byteCount += 1;
    }
    const wordCount = (byteCount - byteCount % 4) / 4;
    bytePosition = byteCount % 4 * 8;
    wordArray[wordCount] = wordArray[wordCount] | 128 << bytePosition;
    wordArray[numberOfWords - 2] = messageLength << 3;
    wordArray[numberOfWords - 1] = messageLength >>> 29;
    return wordArray;
  }
  function wordToHex(value) {
    let result = "";
    for (let count = 0; count <= 3; count += 1) {
      const byte = value >>> count * 8 & 255;
      const temp = `0${byte.toString(16)}`;
      result += temp.slice(-2);
    }
    return result;
  }
  function utf8Encode(value) {
    return unescape(encodeURIComponent(value));
  }
  const x = convertToWordArray(utf8Encode(input));
  let a = 1732584193;
  let b = 4023233417;
  let c = 2562383102;
  let d = 271733878;
  for (let k = 0; k < x.length; k += 16) {
    const aa = a;
    const bb = b;
    const cc = c;
    const dd = d;
    a = ff(a, b, c, d, x[k + 0], 7, 3614090360);
    d = ff(d, a, b, c, x[k + 1], 12, 3905402710);
    c = ff(c, d, a, b, x[k + 2], 17, 606105819);
    b = ff(b, c, d, a, x[k + 3], 22, 3250441966);
    a = ff(a, b, c, d, x[k + 4], 7, 4118548399);
    d = ff(d, a, b, c, x[k + 5], 12, 1200080426);
    c = ff(c, d, a, b, x[k + 6], 17, 2821735955);
    b = ff(b, c, d, a, x[k + 7], 22, 4249261313);
    a = ff(a, b, c, d, x[k + 8], 7, 1770035416);
    d = ff(d, a, b, c, x[k + 9], 12, 2336552879);
    c = ff(c, d, a, b, x[k + 10], 17, 4294925233);
    b = ff(b, c, d, a, x[k + 11], 22, 2304563134);
    a = ff(a, b, c, d, x[k + 12], 7, 1804603682);
    d = ff(d, a, b, c, x[k + 13], 12, 4254626195);
    c = ff(c, d, a, b, x[k + 14], 17, 2792965006);
    b = ff(b, c, d, a, x[k + 15], 22, 1236535329);
    a = gg(a, b, c, d, x[k + 1], 5, 4129170786);
    d = gg(d, a, b, c, x[k + 6], 9, 3225465664);
    c = gg(c, d, a, b, x[k + 11], 14, 643717713);
    b = gg(b, c, d, a, x[k + 0], 20, 3921069994);
    a = gg(a, b, c, d, x[k + 5], 5, 3593408605);
    d = gg(d, a, b, c, x[k + 10], 9, 38016083);
    c = gg(c, d, a, b, x[k + 15], 14, 3634488961);
    b = gg(b, c, d, a, x[k + 4], 20, 3889429448);
    a = gg(a, b, c, d, x[k + 9], 5, 568446438);
    d = gg(d, a, b, c, x[k + 14], 9, 3275163606);
    c = gg(c, d, a, b, x[k + 3], 14, 4107603335);
    b = gg(b, c, d, a, x[k + 8], 20, 1163531501);
    a = gg(a, b, c, d, x[k + 13], 5, 2850285829);
    d = gg(d, a, b, c, x[k + 2], 9, 4243563512);
    c = gg(c, d, a, b, x[k + 7], 14, 1735328473);
    b = gg(b, c, d, a, x[k + 12], 20, 2368359562);
    a = hh(a, b, c, d, x[k + 5], 4, 4294588738);
    d = hh(d, a, b, c, x[k + 8], 11, 2272392833);
    c = hh(c, d, a, b, x[k + 11], 16, 1839030562);
    b = hh(b, c, d, a, x[k + 14], 23, 4259657740);
    a = hh(a, b, c, d, x[k + 1], 4, 2763975236);
    d = hh(d, a, b, c, x[k + 4], 11, 1272893353);
    c = hh(c, d, a, b, x[k + 7], 16, 4139469664);
    b = hh(b, c, d, a, x[k + 10], 23, 3200236656);
    a = hh(a, b, c, d, x[k + 13], 4, 681279174);
    d = hh(d, a, b, c, x[k + 0], 11, 3936430074);
    c = hh(c, d, a, b, x[k + 3], 16, 3572445317);
    b = hh(b, c, d, a, x[k + 6], 23, 76029189);
    a = hh(a, b, c, d, x[k + 9], 4, 3654602809);
    d = hh(d, a, b, c, x[k + 12], 11, 3873151461);
    c = hh(c, d, a, b, x[k + 15], 16, 530742520);
    b = hh(b, c, d, a, x[k + 2], 23, 3299628645);
    a = ii(a, b, c, d, x[k + 0], 6, 4096336452);
    d = ii(d, a, b, c, x[k + 7], 10, 1126891415);
    c = ii(c, d, a, b, x[k + 14], 15, 2878612391);
    b = ii(b, c, d, a, x[k + 5], 21, 4237533241);
    a = ii(a, b, c, d, x[k + 12], 6, 1700485571);
    d = ii(d, a, b, c, x[k + 3], 10, 2399980690);
    c = ii(c, d, a, b, x[k + 10], 15, 4293915773);
    b = ii(b, c, d, a, x[k + 1], 21, 2240044497);
    a = ii(a, b, c, d, x[k + 8], 6, 1873313359);
    d = ii(d, a, b, c, x[k + 15], 10, 4264355552);
    c = ii(c, d, a, b, x[k + 6], 15, 2734768916);
    b = ii(b, c, d, a, x[k + 13], 21, 1309151649);
    a = ii(a, b, c, d, x[k + 4], 6, 4149444226);
    d = ii(d, a, b, c, x[k + 11], 10, 3174756917);
    c = ii(c, d, a, b, x[k + 2], 15, 718787259);
    b = ii(b, c, d, a, x[k + 9], 21, 3951481745);
    a = addUnsigned(a, aa);
    b = addUnsigned(b, bb);
    c = addUnsigned(c, cc);
    d = addUnsigned(d, dd);
  }
  return `${wordToHex(a)}${wordToHex(b)}${wordToHex(c)}${wordToHex(d)}`.toLowerCase();
}
function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return void 0;
  }
}
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
function withTimeout(promise, timeoutMs, message) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer !== null) {
      window.clearTimeout(timer);
    }
  });
}
