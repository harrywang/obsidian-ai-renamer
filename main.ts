import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  SecretComponent,
  Setting,
  TFile,
} from "obsidian";
import { requestUrl } from "obsidian";

// ── Provider definitions ───────────────────────────────────

type ProviderID = "openai" | "anthropic" | "google" | "ollama";

interface ProviderConfig {
  name: string;
  models: { id: string; label: string }[];
  apiKeyPlaceholder: string;
  apiKeyUrl: string;
  needsApiKey: boolean;
}

const PROVIDERS: Record<ProviderID, ProviderConfig> = {
  openai: {
    name: "OpenAI",
    models: [
      { id: "gpt-4o-mini", label: "GPT-4o Mini (fast, cheap)" },
      { id: "gpt-4o", label: "GPT-4o (smarter)" },
      { id: "gpt-4.1-nano", label: "GPT-4.1 Nano (fastest)" },
      { id: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
    ],
    apiKeyPlaceholder: "sk-...",
    apiKeyUrl: "platform.openai.com/api-keys",
    needsApiKey: true,
  },
  anthropic: {
    name: "Anthropic",
    models: [
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (fast, cheap)" },
      { id: "claude-sonnet-4-6-20250514", label: "Claude Sonnet 4.6" },
      { id: "claude-opus-4-6-20250514", label: "Claude Opus 4.6 (smartest)" },
    ],
    apiKeyPlaceholder: "sk-ant-...",
    apiKeyUrl: "console.anthropic.com/settings/keys",
    needsApiKey: true,
  },
  google: {
    name: "Google Gemini",
    models: [
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash (fast, cheap)" },
      { id: "gemini-2.5-pro-preview-05-06", label: "Gemini 2.5 Pro (smartest)" },
    ],
    apiKeyPlaceholder: "AI...",
    apiKeyUrl: "aistudio.google.com/apikey",
    needsApiKey: true,
  },
  ollama: {
    name: "Ollama (local)",
    models: [
      { id: "llama3.2", label: "Llama 3.2" },
      { id: "mistral", label: "Mistral" },
      { id: "gemma2", label: "Gemma 2" },
      { id: "phi3", label: "Phi-3" },
    ],
    apiKeyPlaceholder: "",
    apiKeyUrl: "",
    needsApiKey: false,
  },
};

const SYSTEM_PROMPT =
  "You are a note naming assistant. Given the content of a note, generate a short, descriptive filename (2-5 words, lowercase, separated by hyphens). Do NOT include a date or file extension. Only output the name, nothing else. Examples: meeting-notes-q4-review, recipe-chocolate-cake, project-alpha-todo";

// ── Provider API calls ─────────────────────────────────────

async function callOpenAI(
  apiKey: string,
  model: string,
  content: string
): Promise<string> {
  const response = await requestUrl({
    url: "https://api.openai.com/v1/responses",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      instructions: SYSTEM_PROMPT,
      input: `Generate a short filename for this note:\n\n${content}`,
    }),
  });
  const data = response.json;
  if (data.output_text) return data.output_text;
  if (data.output?.[0]?.content?.[0]?.text)
    return data.output[0].content[0].text;
  throw new Error(`Unexpected response: ${JSON.stringify(data).substring(0, 200)}`);
}

async function callAnthropic(
  apiKey: string,
  model: string,
  content: string
): Promise<string> {
  const response = await requestUrl({
    url: "https://api.anthropic.com/v1/messages",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: 50,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Generate a short filename for this note:\n\n${content}`,
        },
      ],
    }),
  });
  const data = response.json;
  if (data.content?.[0]?.text) return data.content[0].text;
  throw new Error(`Unexpected response: ${JSON.stringify(data).substring(0, 200)}`);
}

async function callGoogle(
  apiKey: string,
  model: string,
  content: string
): Promise<string> {
  const response = await requestUrl({
    url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [
        {
          parts: [
            {
              text: `Generate a short filename for this note:\n\n${content}`,
            },
          ],
        },
      ],
    }),
  });
  const data = response.json;
  if (data.candidates?.[0]?.content?.parts?.[0]?.text)
    return data.candidates[0].content.parts[0].text;
  throw new Error(`Unexpected response: ${JSON.stringify(data).substring(0, 200)}`);
}

async function callOllama(
  baseUrl: string,
  model: string,
  content: string
): Promise<string> {
  const response = await requestUrl({
    url: `${baseUrl}/api/generate`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      system: SYSTEM_PROMPT,
      prompt: `Generate a short filename for this note:\n\n${content}`,
      stream: false,
    }),
  });
  const data = response.json;
  if (data.response) return data.response;
  throw new Error(`Unexpected response: ${JSON.stringify(data).substring(0, 200)}`);
}

// ── Settings ───────────────────────────────────────────────

interface AIRenamerSettings {
  provider: ProviderID;
  secretNames: Record<string, string>; // provider -> secret name in Keychain
  model: string;
  ollamaUrl: string;
  addDatePrefix: boolean;
  dateFormat: string;
  maxContentLength: number;
}

const DEFAULT_SETTINGS: AIRenamerSettings = {
  provider: "openai",
  secretNames: {},
  model: "gpt-4o-mini",
  ollamaUrl: "http://localhost:11434",
  addDatePrefix: false,
  dateFormat: "YYYYMMDD",
  maxContentLength: 1000,
};

// ── Plugin ─────────────────────────────────────────────────

export default class AIRenamerPlugin extends Plugin {
  settings: AIRenamerSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();

    this.addRibbonIcon("wand", "Rename note with AI", async () => {
      const file = this.app.workspace.getActiveFile();
      if (!file) {
        new Notice("No active note to rename.");
        return;
      }
      await this.renameFile(file);
    });

    this.addCommand({
      id: "rename-current-note",
      name: "Rename current note with AI",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) {
          new Notice("No active note to rename.");
          return;
        }
        await this.renameFile(file);
      },
    });

this.addSettingTab(new AIRenamerSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // ── AI naming ────────────────────────────────────────────

  private async generateName(content: string): Promise<string> {
    const { provider, secretNames, model, ollamaUrl } = this.settings;
    const providerConfig = PROVIDERS[provider];

    let apiKey = "";
    if (providerConfig.needsApiKey) {
      const secretName = secretNames[provider];
      if (!secretName) {
        throw new Error(
          `API key not configured. Go to Settings > AI Renamer to select a secret for ${providerConfig.name}.`
        );
      }
      const storage = this.app.secretStorage as unknown as { secrets?: Record<string, string> };
      const secrets = storage?.secrets;
      if (!secrets) {
        throw new Error(
          "Keychain not available. Requires Obsidian v1.11.0 or later."
        );
      }
      apiKey = secrets[secretName] || "";
      if (!apiKey) {
        throw new Error(
          `Secret "${secretName}" not found in Keychain. Add it in Settings > Keychain, then select it in AI Renamer settings.`
        );
      }
    }

    const truncated = content.substring(0, this.settings.maxContentLength);
    let raw: string;

    switch (provider) {
      case "openai":
        raw = await callOpenAI(apiKey, model, truncated);
        break;
      case "anthropic":
        raw = await callAnthropic(apiKey, model, truncated);
        break;
      case "google":
        raw = await callGoogle(apiKey, model, truncated);
        break;
      case "ollama":
        raw = await callOllama(ollamaUrl, model, truncated);
        break;
      default: {
        const _exhaustive: never = provider;
        throw new Error(`Unknown provider: ${_exhaustive}`);
      }
    }

    return raw.trim().toLowerCase().replace(/\s+/g, "-");
  }

  private formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");

    switch (this.settings.dateFormat) {
      case "YYYYMMDD-HHmm":
        return `${y}${m}${d}-${hh}${mm}`;
      case "YYYY-MM-DD":
        return `${y}-${m}-${d}`;
      default:
        return `${y}${m}${d}`;
    }
  }

  private sanitizeFilename(name: string): string {
    return name
      .replace(/[\\/:*?"<>|#^[\]]/g, "")
      .replace(/\.+$/, "")
      .trim();
  }

  async testConnection(): Promise<string> {
    return await this.generateName("This is a test note about quarterly planning and budget review for 2026.");
  }

  async renameFile(file: TFile): Promise<boolean> {
    try {
      const content = await this.app.vault.read(file);
      if (!content.trim()) {
        new Notice(`Skipped "${file.basename}" — empty note.`);
        return false;
      }

      new Notice(`Generating name for "${file.basename}"...`);

      const shortName = await this.generateName(content);
      let newName: string;
      if (this.settings.addDatePrefix) {
        const timestamp = this.formatDate(new Date(file.stat.ctime));
        newName = this.sanitizeFilename(`${timestamp}-${shortName}`);
      } else {
        newName = this.sanitizeFilename(shortName);
      }

      if (newName === file.basename) {
        new Notice(`"${file.basename}" already has a good name.`);
        return false;
      }

      const folder = file.parent?.path || "";
      const newPath = folder ? `${folder}/${newName}.md` : `${newName}.md`;

      if (this.app.vault.getAbstractFileByPath(newPath)) {
        new Notice(`Cannot rename: "${newPath}" already exists.`);
        return false;
      }

      await this.app.fileManager.renameFile(file, newPath);
      new Notice(`Renamed to "${newName}"`);
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(`Rename failed for "${file.basename}": ${message}`);
      console.error("AI Renamer error:", err);
      return false;
    }
  }

}

// ── Settings tab ───────────────────────────────────────────

class AIRenamerSettingTab extends PluginSettingTab {
  plugin: AIRenamerPlugin;

  constructor(app: App, plugin: AIRenamerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("AI Renamer settings").setHeading();

    const currentProvider = this.plugin.settings.provider;
    const providerConfig = PROVIDERS[currentProvider];

    // Provider selector
    new Setting(containerEl)
      .setName("AI provider")
      .setDesc("Choose which AI service to use for generating names.")
      .addDropdown((dropdown) => {
        for (const [id, config] of Object.entries(PROVIDERS)) {
          dropdown.addOption(id, config.name);
        }
        dropdown.setValue(currentProvider).onChange(async (value) => {
          this.plugin.settings.provider = value as ProviderID;
          // Set default model for the new provider
          const newProvider = PROVIDERS[value as ProviderID];
          this.plugin.settings.model = newProvider.models[0].id;
          await this.plugin.saveSettings();
          this.display();
        });
      });

    // API key via Keychain (not for Ollama)
    if (providerConfig.needsApiKey) {
      new Setting(containerEl)
        .setName("API key")
        .setDesc(
          `Select a secret from Keychain. Add your ${providerConfig.name} key in Settings > Keychain first (get one at ${providerConfig.apiKeyUrl}).`
        )
        .addComponent((el) =>
          new SecretComponent(this.app, el)
            .setValue(this.plugin.settings.secretNames[currentProvider] || "")
            .onChange(async (value: string) => {
              this.plugin.settings.secretNames[currentProvider] = value;
              await this.plugin.saveSettings();
            })
        );
    }

    // Ollama URL
    if (currentProvider === "ollama") {
      new Setting(containerEl)
        .setName("Ollama URL")
        .setDesc("Base URL for your local Ollama instance.")
        .addText((text) =>
          text
            .setPlaceholder("http://localhost:11434")
            .setValue(this.plugin.settings.ollamaUrl)
            .onChange(async (value) => {
              this.plugin.settings.ollamaUrl = value.trim();
              await this.plugin.saveSettings();
            })
        );
    }

    // Model selector
    if (currentProvider === "ollama") {
      // Ollama: fetch installed models dynamically
      const modelSetting = new Setting(containerEl)
        .setName("Model")
        .setDesc("Loading installed Ollama models...");

      void this.loadOllamaModels(modelSetting);
    } else {
      new Setting(containerEl)
        .setName("Model")
        .setDesc(`${providerConfig.name} model to use for generating names.`)
        .addDropdown((dropdown) => {
          for (const model of providerConfig.models) {
            dropdown.addOption(model.id, model.label);
          }
          dropdown
            .setValue(this.plugin.settings.model)
            .onChange(async (value) => {
              this.plugin.settings.model = value;
              await this.plugin.saveSettings();
            });
        });
    }

    // Test connection button
    new Setting(containerEl)
      .setName("Test connection")
      .setDesc("Send a test request to verify your settings work.")
      .addButton((btn) =>
        btn.setButtonText("Test").onClick(async () => {
          btn.setDisabled(true);
          btn.setButtonText("Testing...");
          try {
            const name = await this.plugin.testConnection();
            new Notice(`Test passed! Generated name: "${name}"`);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            new Notice(`Test failed: ${message}`, 10000);
          }
          btn.setDisabled(false);
          btn.setButtonText("Test");
        })
      );

    // Date prefix toggle
    new Setting(containerEl)
      .setName("Add date prefix")
      .setDesc(
        "Prepend a timestamp to the AI-generated name (e.g., 20260312-meeting-notes)."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.addDatePrefix)
          .onChange(async (value) => {
            this.plugin.settings.addDatePrefix = value;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.addDatePrefix) {
      new Setting(containerEl)
        .setName("Date format")
        .setDesc("Timestamp format for the prefix.")
        .addDropdown((dropdown) =>
          dropdown
            .addOption("YYYYMMDD", "20260312")
            .addOption("YYYYMMDD-HHmm", "20260312-1430")
            .addOption("YYYY-MM-DD", "2026-03-12")
            .setValue(this.plugin.settings.dateFormat)
            .onChange(async (value) => {
              this.plugin.settings.dateFormat = value;
              await this.plugin.saveSettings();
            })
        );
    }

    // Max content length
    new Setting(containerEl)
      .setName("Max content length")
      .setDesc(
        "Maximum number of characters sent to the AI (saves tokens on long notes)."
      )
      .addText((text) =>
        text
          .setPlaceholder("1000")
          .setValue(String(this.plugin.settings.maxContentLength))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            this.plugin.settings.maxContentLength = isNaN(num) ? 1000 : num;
            await this.plugin.saveSettings();
          })
      );
  }

  private async loadOllamaModels(setting: Setting): Promise<void> {
    try {
      const response = await requestUrl({
        url: `${this.plugin.settings.ollamaUrl}/api/tags`,
        method: "GET",
      });
      const data = response.json;
      const models: { name: string }[] = data.models || [];

      if (models.length === 0) {
        setting.setDesc(
          "No models installed. Run 'ollama pull <model>' in terminal, then click Refresh."
        );
        setting.addButton((btn) =>
          btn.setButtonText("Refresh").onClick(() => this.display())
        );
        return;
      }

      setting.setDesc("Select an installed Ollama model.");
      setting.addButton((btn) =>
        btn.setButtonText("Refresh").onClick(() => this.display())
      );
      setting.addDropdown((dropdown) => {
        for (const model of models) {
          dropdown.addOption(model.name, model.name);
        }
        dropdown
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = value;
            await this.plugin.saveSettings();
          });
      });
    } catch {
      setting.setDesc(
        "Could not connect to Ollama. Is it running?"
      );
      setting.addButton((btn) =>
        btn.setButtonText("Refresh").onClick(() => this.display())
      );
    }
  }
}
