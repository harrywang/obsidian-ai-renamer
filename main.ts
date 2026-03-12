import {
  App,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
} from "obsidian";
import { requestUrl } from "obsidian";

interface AIRenamerSettings {
  openaiApiKey: string;
  model: string;
  dateFormat: string;
  maxContentLength: number;
  excludeFolders: string;
}

const DEFAULT_SETTINGS: AIRenamerSettings = {
  openaiApiKey: "",
  model: "gpt-4o-mini",
  dateFormat: "YYYYMMDD",
  maxContentLength: 1000,
  excludeFolders: "",
};

export default class AIRenamerPlugin extends Plugin {
  settings: AIRenamerSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();

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

    this.addCommand({
      id: "rename-all-notes",
      name: "Rename all notes in vault with AI",
      callback: () => {
        new ConfirmModal(
          this.app,
          "Rename all notes?",
          "This will rename every Markdown file in your vault using AI. Files that already match the timestamp pattern will be skipped.",
          async () => await this.renameAll()
        ).open();
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
    const apiKey = this.settings.openaiApiKey;
    if (!apiKey) {
      throw new Error(
        "OpenAI API key not set. Go to Settings > AI Renamer to add it."
      );
    }

    // Truncate content to save tokens
    const truncated = content.substring(0, this.settings.maxContentLength);

    const response = await requestUrl({
      url: "https://api.openai.com/v1/responses",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.settings.model,
        instructions:
          "You are a note naming assistant. Given the content of a note, generate a short, descriptive filename (2-5 words, lowercase, separated by hyphens). Do NOT include a date or file extension. Only output the name, nothing else. Examples: meeting-notes-q4-review, recipe-chocolate-cake, project-alpha-todo",
        input: `Generate a short filename for this note:\n\n${truncated}`,
      }),
    });

    const data = response.json;

    // Use the convenience output_text field
    if (data.output_text) {
      return data.output_text.trim().toLowerCase().replace(/\s+/g, "-");
    }

    // Fallback to nested path
    if (data.output?.[0]?.content?.[0]?.text) {
      return data.output[0].content[0].text
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-");
    }

    throw new Error(
      `Unexpected API response: ${JSON.stringify(data).substring(0, 200)}`
    );
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

  private isAlreadyRenamed(filename: string): boolean {
    // Match files that start with a date pattern like 20260312 or 2026-03-12
    return /^\d{4}-?\d{2}-?\d{2}/.test(filename);
  }

  private sanitizeFilename(name: string): string {
    // Remove characters that are invalid in filenames
    return name
      .replace(/[\\/:*?"<>|#^[\]]/g, "")
      .replace(/\.+$/, "")
      .trim();
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
      const timestamp = this.formatDate(new Date(file.stat.ctime));
      const newName = this.sanitizeFilename(`${timestamp}-${shortName}`);

      if (newName === file.basename) {
        new Notice(`"${file.basename}" already has a good name.`);
        return false;
      }

      // Build the new path preserving the folder
      const folder = file.parent?.path || "";
      const newPath = folder
        ? `${folder}/${newName}.md`
        : `${newName}.md`;

      // Check if target already exists
      if (this.app.vault.getAbstractFileByPath(newPath)) {
        new Notice(`Cannot rename: "${newPath}" already exists.`);
        return false;
      }

      await this.app.fileManager.renameFile(file, newPath);
      new Notice(`Renamed to "${newName}"`);
      return true;
    } catch (err: any) {
      new Notice(`Rename failed for "${file.basename}": ${err.message}`);
      console.error("AI Renamer error:", err);
      return false;
    }
  }

  async renameAll(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    const excludes = this.settings.excludeFolders
      .split(",")
      .map((f) => f.trim())
      .filter((f) => f);

    let renamed = 0;
    let skipped = 0;
    let failed = 0;

    for (const file of files) {
      // Skip excluded folders
      if (excludes.some((ex) => file.path.startsWith(ex))) {
        skipped++;
        continue;
      }

      // Skip already-renamed files
      if (this.isAlreadyRenamed(file.basename)) {
        skipped++;
        continue;
      }

      const success = await this.renameFile(file);
      if (success) {
        renamed++;
      } else {
        failed++;
      }

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    new Notice(
      `Done! Renamed: ${renamed}, Skipped: ${skipped}, Failed: ${failed}`,
      10000
    );
  }
}

// ── Confirm modal ──────────────────────────────────────────

class ConfirmModal extends Modal {
  title: string;
  message: string;
  onConfirm: () => Promise<void>;

  constructor(
    app: App,
    title: string,
    message: string,
    onConfirm: () => Promise<void>
  ) {
    super(app);
    this.title = title;
    this.message = message;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: this.title });
    contentEl.createEl("p", { text: this.message });

    const btnContainer = contentEl.createDiv({
      cls: "modal-button-container",
    });

    const confirmBtn = btnContainer.createEl("button", {
      text: "Rename All",
      cls: "mod-cta",
    });
    confirmBtn.addEventListener("click", async () => {
      this.close();
      await this.onConfirm();
    });

    const cancelBtn = btnContainer.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());
  }

  onClose() {
    this.contentEl.empty();
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

    containerEl.createEl("h2", { text: "AI Renamer Settings" });

    new Setting(containerEl)
      .setName("OpenAI API key")
      .setDesc("Your OpenAI API key. Get one at platform.openai.com/api-keys")
      .addText((text) =>
        text
          .setPlaceholder("sk-...")
          .setValue(this.plugin.settings.openaiApiKey)
          .onChange(async (value) => {
            this.plugin.settings.openaiApiKey = value.trim();
            await this.plugin.saveSettings();
          })
      )
      .then((setting) => {
        const input = setting.controlEl.querySelector("input");
        if (input) input.type = "password";
      });

    new Setting(containerEl)
      .setName("Model")
      .setDesc("OpenAI model to use for generating names.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("gpt-4o-mini", "GPT-4o Mini (fast, cheap)")
          .addOption("gpt-4o", "GPT-4o (smarter)")
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Date format")
      .setDesc("Timestamp format prepended to the AI-generated name.")
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

    new Setting(containerEl)
      .setName("Exclude folders")
      .setDesc(
        "Comma-separated folder paths to skip when renaming all (e.g., templates,daily)."
      )
      .addText((text) =>
        text
          .setPlaceholder("templates,daily")
          .setValue(this.plugin.settings.excludeFolders)
          .onChange(async (value) => {
            this.plugin.settings.excludeFolders = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
