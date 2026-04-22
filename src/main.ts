import {
  App,
  moment,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  requestUrl,
  type View
} from "obsidian";

interface PluginSettings {
  apiUrl: string;
  apiKey: string;
  appId: string;
  sourceLang: "auto" | "en" | "zh";
  targetLang: "en" | "zh";
  autoTranslateDelayMs: number;
  requestTimeoutMs: number;
}

interface SelectionSnapshot {
  key: string;
  text: string;
  anchorRect: DOMRect;
}

interface TranslationResponse {
  translation: string;
  raw: unknown;
}

const DEFAULT_SETTINGS: PluginSettings = {
  apiUrl: "https://api.niutrans.com/v2/text/translate",
  apiKey: "",
  appId: "",
  sourceLang: "en",
  targetLang: "zh",
  autoTranslateDelayMs: 350,
  requestTimeoutMs: 15000
};

export default class PdfNiuTransAutoTranslatorPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  private panel!: TranslationPanel;
  private currentSelection: SelectionSnapshot | null = null;
  private refreshTimer: number | null = null;
  private translateTimer: number | null = null;
  private requestSequence = 0;

  async onload(): Promise<void> {
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

  onunload(): void {
    this.clearRefreshTimer();
    this.clearTranslateTimer();
  }

  async loadSettings(): Promise<void> {
    this.settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      ...(await this.loadData())
    });
  }

  async saveSettings(): Promise<void> {
    this.settings = normalizeSettings(this.settings);
    await this.saveData(this.settings);
  }

  private scheduleRefresh(delayMs: number): void {
    this.clearRefreshTimer();
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      this.refreshSelection();
    }, delayMs);
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private clearTranslateTimer(): void {
    if (this.translateTimer !== null) {
      window.clearTimeout(this.translateTimer);
      this.translateTimer = null;
    }
  }

  private handlePointerDown(event: PointerEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest(".pdf-niutrans-panel")) {
      return;
    }

    if (!target || !this.isInsidePdfView(target)) {
      this.resetSelection();
    }
  }

  private isInsidePdfView(target: HTMLElement): boolean {
    const view = this.getActiveView();
    return Boolean(view && view.getViewType() === "pdf" && view.containerEl.contains(target));
  }

  private refreshSelection(): void {
    const snapshot = this.readPdfSelection();
    if (!snapshot) {
      this.resetSelection();
      return;
    }

    const previousKey = this.currentSelection?.key ?? null;
    this.currentSelection = snapshot;

    if (previousKey === snapshot.key) {
      this.panel.updateAnchor(snapshot.anchorRect);
      return;
    }

    this.panel.showLoading(snapshot.anchorRect, "Translating selection...");
    this.scheduleTranslation(snapshot);
  }

  private resetSelection(): void {
    this.currentSelection = null;
    this.clearTranslateTimer();
    this.panel.hide();
  }

  private scheduleTranslation(snapshot: SelectionSnapshot): void {
    this.clearTranslateTimer();
    this.translateTimer = window.setTimeout(() => {
      this.translateTimer = null;
      if (this.currentSelection?.key !== snapshot.key) {
        return;
      }

      void this.translateSelection(snapshot);
    }, this.settings.autoTranslateDelayMs);
  }

  private readPdfSelection(): SelectionSnapshot | null {
    const view = this.getActiveView();
    if (!view || view.getViewType() !== "pdf") {
      return null;
    }

    const selection = window.getSelection();
    const text = selection?.toString() ?? "";
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

  private getActiveView(): View | null {
    return this.app.workspace.activeLeaf?.view ?? null;
  }

  private async translateSelection(snapshot: SelectionSnapshot): Promise<void> {
    if (snapshot.text.length > 2000) {
      this.panel.showError(snapshot.anchorRect, "选中文本过长，请控制在 2000 字符以内。");
      return;
    }

    if (!this.settings.apiUrl.trim()) {
      this.panel.showError(snapshot.anchorRect, "请先在设置中填写小牛翻译接口地址。");
      return;
    }

    if (!this.settings.apiKey.trim()) {
      this.panel.showError(snapshot.anchorRect, "请先在设置中填写 API Key。");
      return;
    }

    if (!this.settings.appId.trim()) {
      this.panel.showError(snapshot.anchorRect, "请先在设置中填写 App ID。");
      return;
    }

    if (this.settings.sourceLang !== "auto" && this.settings.sourceLang === this.settings.targetLang) {
      this.panel.showError(snapshot.anchorRect, "源语言和目标语言不能相同。");
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

      const message = error instanceof Error ? error.message : "翻译失败";
      this.panel.showError(snapshot.anchorRect, message);
    }
  }

  private isCurrentRequest(selectionKey: string, requestId: number): boolean {
    return this.currentSelection?.key === selectionKey && requestId === this.requestSequence;
  }

  private async requestTranslation(text: string): Promise<TranslationResponse> {
    const timestamp = Number(moment().format("X"));
    const payload = {
      from: this.settings.sourceLang,
      to: this.settings.targetLang,
      srcText: text,
      appId: this.settings.appId.trim(),
      timestamp
    };
    const authStr = createAuthStr(payload, this.settings.apiKey.trim());

    const response = await withTimeout(
      requestUrl({
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
      `翻译请求超时（>${this.settings.requestTimeoutMs}ms）`
    );

    const data = response.json ?? tryParseJson(response.text ?? "");
    const translation = extractTranslation(data);
    if (response.status >= 400) {
      throw new Error(extractErrorMessage(data) || `翻译请求失败（HTTP ${response.status}）`);
    }

    if (!translation) {
      throw new Error(extractErrorMessage(data) || "接口返回里没有找到译文。");
    }

    return {
      translation,
      raw: data
    };
  }
}

class TranslationPanel {
  private readonly rootEl: HTMLDivElement;
  private readonly statusEl: HTMLParagraphElement;
  private readonly contentEl: HTMLParagraphElement;

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
    closeButtonEl.textContent = "×";
    closeButtonEl.addEventListener("click", () => this.hide());

    headerEl.append(titleEl, closeButtonEl);

    this.statusEl = document.createElement("p");
    this.statusEl.className = "pdf-niutrans-panel__status";

    this.contentEl = document.createElement("p");
    this.contentEl.className = "pdf-niutrans-panel__content";

    this.rootEl.append(headerEl, this.statusEl, this.contentEl);
    document.body.appendChild(this.rootEl);
  }

  destroy(): void {
    this.rootEl.remove();
  }

  showLoading(anchorRect: DOMRect, status: string): void {
    this.rootEl.classList.remove("is-error");
    this.statusEl.textContent = status;
    this.contentEl.textContent = "请稍候...";
    this.show(anchorRect);
  }

  showResult(anchorRect: DOMRect, text: string): void {
    this.rootEl.classList.remove("is-error");
    this.statusEl.textContent = "";
    this.contentEl.textContent = text;
    this.show(anchorRect);
  }

  showError(anchorRect: DOMRect, message: string): void {
    this.rootEl.classList.add("is-error");
    this.statusEl.textContent = "翻译失败";
    this.contentEl.textContent = message;
    this.show(anchorRect);
  }

  updateAnchor(anchorRect: DOMRect): void {
    if (this.rootEl.classList.contains("is-visible")) {
      this.position(anchorRect);
    }
  }

  hide(): void {
    this.rootEl.classList.remove("is-visible", "is-error");
  }

  private show(anchorRect: DOMRect): void {
    this.rootEl.classList.add("is-visible");
    this.position(anchorRect);
  }

  private position(anchorRect: DOMRect): void {
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
}

class PdfNiuTransSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: PdfNiuTransAutoTranslatorPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "PDF NiuTrans Auto Translator" });
    containerEl.createEl("p", {
      text: "Only works in PDF views. Translation starts automatically after the selection becomes stable."
    });

    new Setting(containerEl)
      .setName("API URL")
      .setDesc("Fill in the NiuTrans text translation endpoint.")
      .addText((text) =>
        text
          .setPlaceholder("https://...your-niutrans-endpoint...")
          .setValue(this.plugin.settings.apiUrl)
          .onChange(async (value) => {
            this.plugin.settings.apiUrl = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("API Key")
      .setDesc("Stored in this vault only.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setValue(this.plugin.settings.apiKey).onChange(async (value) => {
          this.plugin.settings.apiKey = value.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("App ID")
      .setDesc("NiuTrans API application identifier.")
      .addText((text) =>
        text
          .setPlaceholder("wPO...")
          .setValue(this.plugin.settings.appId)
          .onChange(async (value) => {
            this.plugin.settings.appId = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Source language")
      .setDesc("Only supports auto, English, and Chinese in this minimal version.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("auto", "Auto")
          .addOption("en", "English")
          .addOption("zh", "Chinese")
          .setValue(this.plugin.settings.sourceLang)
          .onChange(async (value: PluginSettings["sourceLang"]) => {
            this.plugin.settings.sourceLang = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Target language")
      .setDesc("Only supports English and Chinese in this minimal version.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("zh", "Chinese")
          .addOption("en", "English")
          .setValue(this.plugin.settings.targetLang)
          .onChange(async (value: PluginSettings["targetLang"]) => {
            this.plugin.settings.targetLang = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Auto translate delay")
      .setDesc("Translation starts after the selection remains stable for this many milliseconds.")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.autoTranslateDelayMs)).onChange(async (value) => {
          this.plugin.settings.autoTranslateDelayMs = Number.parseInt(value, 10);
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Request timeout")
      .setDesc("Client-side timeout in milliseconds.")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.requestTimeoutMs)).onChange(async (value) => {
          this.plugin.settings.requestTimeoutMs = Number.parseInt(value, 10);
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Test notice")
      .setDesc("This only validates local settings, not the remote API.")
      .addButton((button) =>
        button.setButtonText("Check settings").onClick(() => {
          const warnings: string[] = [];
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
            new Notice(warnings.join(" / "));
            return;
          }

          new Notice("Settings look usable.");
        })
      );
  }
}

function normalizeSettings(settings: PluginSettings): PluginSettings {
  const autoTranslateDelayMs = Number(settings.autoTranslateDelayMs);
  const requestTimeoutMs = Number(settings.requestTimeoutMs);

  return {
    apiUrl: settings.apiUrl?.trim?.() ?? "",
    apiKey: settings.apiKey?.trim?.() ?? "",
    appId: settings.appId?.trim?.() ?? "",
    sourceLang: normalizeSourceLang(settings.sourceLang),
    targetLang: settings.targetLang === "en" ? "en" : "zh",
    autoTranslateDelayMs: Number.isFinite(autoTranslateDelayMs) ? clamp(autoTranslateDelayMs, 100, 2000) : DEFAULT_SETTINGS.autoTranslateDelayMs,
    requestTimeoutMs: Number.isFinite(requestTimeoutMs) ? clamp(requestTimeoutMs, 1000, 60000) : DEFAULT_SETTINGS.requestTimeoutMs
  };
}

function normalizeSourceLang(value: PluginSettings["sourceLang"]): PluginSettings["sourceLang"] {
  if (value === "auto" || value === "zh") {
    return value;
  }

  return "en";
}

function getAnchorRect(range: Range): DOMRect | null {
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

function buildSelectionKey(text: string, anchorRect: DOMRect): string {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  return `${normalizedText}::${Math.round(anchorRect.left)}:${Math.round(anchorRect.top)}:${Math.round(anchorRect.width)}:${Math.round(anchorRect.height)}`;
}

function extractTranslation(data: unknown): string {
  if (!data || typeof data !== "object") {
    return "";
  }

  const record = data as Record<string, unknown>;
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

function extractErrorMessage(data: unknown): string {
  if (!data || typeof data !== "object") {
    return "";
  }

  const record = data as Record<string, unknown>;
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
    return `错误码：${record.error_code.trim()}`;
  }

  if (typeof record.errorCode === "string" && record.errorCode.trim()) {
    return `错误码：${record.errorCode.trim()}`;
  }

  return "";
}

function createAuthStr(
  payload: Record<string, string | number>,
  apiKey: string
): string {
  const signParams: Record<string, string | number> = {
    ...payload,
    apikey: apiKey
  };
  const paramStr = Object.keys(signParams)
    .sort()
    .filter((key) => signParams[key] !== "" && signParams[key] !== undefined && signParams[key] !== null)
    .map((key) => `${key}=${signParams[key]}`)
    .join("&");

  return md5(paramStr);
}

function md5(input: string): string {
  function rotateLeft(value: number, shift: number): number {
    return (value << shift) | (value >>> (32 - shift));
  }

  function addUnsigned(x: number, y: number): number {
    const x4 = x & 0x40000000;
    const y4 = y & 0x40000000;
    const x8 = x & 0x80000000;
    const y8 = y & 0x80000000;
    const result = (x & 0x3fffffff) + (y & 0x3fffffff);

    if (x4 & y4) {
      return result ^ 0x80000000 ^ x8 ^ y8;
    }

    if (x4 | y4) {
      if (result & 0x40000000) {
        return result ^ 0xc0000000 ^ x8 ^ y8;
      }

      return result ^ 0x40000000 ^ x8 ^ y8;
    }

    return result ^ x8 ^ y8;
  }

  function f(x: number, y: number, z: number): number {
    return (x & y) | (~x & z);
  }

  function g(x: number, y: number, z: number): number {
    return (x & z) | (y & ~z);
  }

  function h(x: number, y: number, z: number): number {
    return x ^ y ^ z;
  }

  function i(x: number, y: number, z: number): number {
    return y ^ (x | ~z);
  }

  function ff(a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number {
    a = addUnsigned(a, addUnsigned(addUnsigned(f(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  function gg(a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number {
    a = addUnsigned(a, addUnsigned(addUnsigned(g(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  function hh(a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number {
    a = addUnsigned(a, addUnsigned(addUnsigned(h(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  function ii(a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number {
    a = addUnsigned(a, addUnsigned(addUnsigned(i(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  function convertToWordArray(value: string): number[] {
    const messageLength = value.length;
    const numberOfWordsTemp1 = messageLength + 8;
    const numberOfWordsTemp2 = (numberOfWordsTemp1 - (numberOfWordsTemp1 % 64)) / 64;
    const numberOfWords = (numberOfWordsTemp2 + 1) * 16;
    const wordArray = new Array<number>(numberOfWords - 1);
    let bytePosition = 0;
    let byteCount = 0;

    while (byteCount < messageLength) {
      const wordCount = (byteCount - (byteCount % 4)) / 4;
      bytePosition = (byteCount % 4) * 8;
      wordArray[wordCount] = wordArray[wordCount] | (value.charCodeAt(byteCount) << bytePosition);
      byteCount += 1;
    }

    const wordCount = (byteCount - (byteCount % 4)) / 4;
    bytePosition = (byteCount % 4) * 8;
    wordArray[wordCount] = wordArray[wordCount] | (0x80 << bytePosition);
    wordArray[numberOfWords - 2] = messageLength << 3;
    wordArray[numberOfWords - 1] = messageLength >>> 29;

    return wordArray;
  }

  function wordToHex(value: number): string {
    let result = "";
    for (let count = 0; count <= 3; count += 1) {
      const byte = (value >>> (count * 8)) & 255;
      const temp = `0${byte.toString(16)}`;
      result += temp.slice(-2);
    }

    return result;
  }

  function utf8Encode(value: string): string {
    return unescape(encodeURIComponent(value));
  }

  const x = convertToWordArray(utf8Encode(input));
  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;

  for (let k = 0; k < x.length; k += 16) {
    const aa = a;
    const bb = b;
    const cc = c;
    const dd = d;

    a = ff(a, b, c, d, x[k + 0], 7, 0xd76aa478);
    d = ff(d, a, b, c, x[k + 1], 12, 0xe8c7b756);
    c = ff(c, d, a, b, x[k + 2], 17, 0x242070db);
    b = ff(b, c, d, a, x[k + 3], 22, 0xc1bdceee);
    a = ff(a, b, c, d, x[k + 4], 7, 0xf57c0faf);
    d = ff(d, a, b, c, x[k + 5], 12, 0x4787c62a);
    c = ff(c, d, a, b, x[k + 6], 17, 0xa8304613);
    b = ff(b, c, d, a, x[k + 7], 22, 0xfd469501);
    a = ff(a, b, c, d, x[k + 8], 7, 0x698098d8);
    d = ff(d, a, b, c, x[k + 9], 12, 0x8b44f7af);
    c = ff(c, d, a, b, x[k + 10], 17, 0xffff5bb1);
    b = ff(b, c, d, a, x[k + 11], 22, 0x895cd7be);
    a = ff(a, b, c, d, x[k + 12], 7, 0x6b901122);
    d = ff(d, a, b, c, x[k + 13], 12, 0xfd987193);
    c = ff(c, d, a, b, x[k + 14], 17, 0xa679438e);
    b = ff(b, c, d, a, x[k + 15], 22, 0x49b40821);

    a = gg(a, b, c, d, x[k + 1], 5, 0xf61e2562);
    d = gg(d, a, b, c, x[k + 6], 9, 0xc040b340);
    c = gg(c, d, a, b, x[k + 11], 14, 0x265e5a51);
    b = gg(b, c, d, a, x[k + 0], 20, 0xe9b6c7aa);
    a = gg(a, b, c, d, x[k + 5], 5, 0xd62f105d);
    d = gg(d, a, b, c, x[k + 10], 9, 0x02441453);
    c = gg(c, d, a, b, x[k + 15], 14, 0xd8a1e681);
    b = gg(b, c, d, a, x[k + 4], 20, 0xe7d3fbc8);
    a = gg(a, b, c, d, x[k + 9], 5, 0x21e1cde6);
    d = gg(d, a, b, c, x[k + 14], 9, 0xc33707d6);
    c = gg(c, d, a, b, x[k + 3], 14, 0xf4d50d87);
    b = gg(b, c, d, a, x[k + 8], 20, 0x455a14ed);
    a = gg(a, b, c, d, x[k + 13], 5, 0xa9e3e905);
    d = gg(d, a, b, c, x[k + 2], 9, 0xfcefa3f8);
    c = gg(c, d, a, b, x[k + 7], 14, 0x676f02d9);
    b = gg(b, c, d, a, x[k + 12], 20, 0x8d2a4c8a);

    a = hh(a, b, c, d, x[k + 5], 4, 0xfffa3942);
    d = hh(d, a, b, c, x[k + 8], 11, 0x8771f681);
    c = hh(c, d, a, b, x[k + 11], 16, 0x6d9d6122);
    b = hh(b, c, d, a, x[k + 14], 23, 0xfde5380c);
    a = hh(a, b, c, d, x[k + 1], 4, 0xa4beea44);
    d = hh(d, a, b, c, x[k + 4], 11, 0x4bdecfa9);
    c = hh(c, d, a, b, x[k + 7], 16, 0xf6bb4b60);
    b = hh(b, c, d, a, x[k + 10], 23, 0xbebfbc70);
    a = hh(a, b, c, d, x[k + 13], 4, 0x289b7ec6);
    d = hh(d, a, b, c, x[k + 0], 11, 0xeaa127fa);
    c = hh(c, d, a, b, x[k + 3], 16, 0xd4ef3085);
    b = hh(b, c, d, a, x[k + 6], 23, 0x04881d05);
    a = hh(a, b, c, d, x[k + 9], 4, 0xd9d4d039);
    d = hh(d, a, b, c, x[k + 12], 11, 0xe6db99e5);
    c = hh(c, d, a, b, x[k + 15], 16, 0x1fa27cf8);
    b = hh(b, c, d, a, x[k + 2], 23, 0xc4ac5665);

    a = ii(a, b, c, d, x[k + 0], 6, 0xf4292244);
    d = ii(d, a, b, c, x[k + 7], 10, 0x432aff97);
    c = ii(c, d, a, b, x[k + 14], 15, 0xab9423a7);
    b = ii(b, c, d, a, x[k + 5], 21, 0xfc93a039);
    a = ii(a, b, c, d, x[k + 12], 6, 0x655b59c3);
    d = ii(d, a, b, c, x[k + 3], 10, 0x8f0ccc92);
    c = ii(c, d, a, b, x[k + 10], 15, 0xffeff47d);
    b = ii(b, c, d, a, x[k + 1], 21, 0x85845dd1);
    a = ii(a, b, c, d, x[k + 8], 6, 0x6fa87e4f);
    d = ii(d, a, b, c, x[k + 15], 10, 0xfe2ce6e0);
    c = ii(c, d, a, b, x[k + 6], 15, 0xa3014314);
    b = ii(b, c, d, a, x[k + 13], 21, 0x4e0811a1);
    a = ii(a, b, c, d, x[k + 4], 6, 0xf7537e82);
    d = ii(d, a, b, c, x[k + 11], 10, 0xbd3af235);
    c = ii(c, d, a, b, x[k + 2], 15, 0x2ad7d2bb);
    b = ii(b, c, d, a, x[k + 9], 21, 0xeb86d391);

    a = addUnsigned(a, aa);
    b = addUnsigned(b, bb);
    c = addUnsigned(c, cc);
    d = addUnsigned(d, dd);
  }

  return `${wordToHex(a)}${wordToHex(b)}${wordToHex(c)}${wordToHex(d)}`.toLowerCase();
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: number | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer !== null) {
      window.clearTimeout(timer);
    }
  });
}
