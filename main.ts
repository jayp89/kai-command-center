import { App, ItemView, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, TFile } from 'obsidian';

interface KaiCommandCenterSettings {
	activeWidgets: string[];
}

const DEFAULT_SETTINGS: KaiCommandCenterSettings = {
	activeWidgets: ['metrics', 'schedule', 'outputs']
}

const VIEW_TYPE_KAI_DASHBOARD = "kai-dashboard-view";

class KaiDashboardView extends ItemView {
	plugin: KaiCommandCenterPlugin;
	dailyData: any[] = [];

	constructor(leaf: WorkspaceLeaf, plugin: KaiCommandCenterPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return VIEW_TYPE_KAI_DASHBOARD;
	}

	getDisplayText() {
		return "KAI Command Center";
	}

	getIcon() {
		return "layout-dashboard";
	}

	async onOpen() {
		await this.loadData();
		this.render();

		// Setup an interval or event listener to refresh data occasionally or when files change
		this.registerEvent(
			this.app.metadataCache.on('changed', () => {
				this.loadData().then(() => this.render());
			})
		);
	}

	async loadData() {
		this.dailyData = [];
		const files = this.app.vault.getMarkdownFiles();
		const dailyNotes = files.filter(f => f.path.startsWith('00 Human/10 Daily Notes/'));

		// Sort by name descending to get newest first
		dailyNotes.sort((a, b) => b.basename.localeCompare(a.basename));

		// Parse top 5 recent notes
		for (const file of dailyNotes.slice(0, 5)) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (cache && cache.frontmatter) {
				this.dailyData.push({
					date: file.basename,
					frontmatter: cache.frontmatter
				});
			} else {
				this.dailyData.push({
					date: file.basename,
					frontmatter: {}
				});
			}
		}
	}

	toggleWidget(widgetName: string) {
		const idx = this.plugin.settings.activeWidgets.indexOf(widgetName);
		if (idx > -1) {
			this.plugin.settings.activeWidgets.splice(idx, 1);
		} else {
			this.plugin.settings.activeWidgets.push(widgetName);
		}
		this.plugin.saveSettings();
		this.render();
	}

	render() {
		const container = this.containerEl.children[1];
		container.empty();

		const rootEl = container.createEl("div", { cls: "kai-dashboard-container" });

		// Header
		const headerEl = rootEl.createEl("div", { cls: "kai-dashboard-header" });
		headerEl.createEl("h1", { text: "KAI Command Center" });

		// Toggles
		const togglePanel = headerEl.createEl("div", { cls: "kai-toggle-panel" });
		const widgets = ['metrics', 'schedule', 'outputs'];
		widgets.forEach(w => {
			const btn = togglePanel.createEl("button", {
				text: w.charAt(0).toUpperCase() + w.slice(1),
				cls: `kai-toggle-btn ${this.plugin.settings.activeWidgets.includes(w) ? 'active' : ''}`
			});
			btn.onclick = () => this.toggleWidget(w);
		});

		// Grid
		const gridEl = rootEl.createEl("div", { cls: "kai-widget-grid" });

		if (this.plugin.settings.activeWidgets.includes('metrics')) {
			this.renderMetricsWidget(gridEl);
		}
		if (this.plugin.settings.activeWidgets.includes('schedule')) {
			this.renderScheduleWidget(gridEl);
		}
		if (this.plugin.settings.activeWidgets.includes('outputs')) {
			this.renderOutputsWidget(gridEl);
		}
	}

	renderMetricsWidget(parent: HTMLElement) {
		const widget = parent.createEl("div", { cls: "kai-widget" });
		const header = widget.createEl("div", { cls: "kai-widget-header" });
		header.createEl("h3", { text: "Recent Metrics" });

		const content = widget.createEl("div", { cls: "kai-widget-content" });

		if (this.dailyData.length === 0) {
			content.createEl("p", { text: "No daily notes found." });
			return;
		}

		// Get the most recent day's metrics
		const latest = this.dailyData[0];
		content.createEl("h4", { text: `For: ${latest.date}` });

		const fm = latest.frontmatter;
		const metrics = fm.metrics || {};
		const keys = Object.keys(metrics);

		if (keys.length === 0) {
			content.createEl("p", { text: "No metrics found in today's frontmatter." });
			return;
		}

		keys.forEach(k => {
			const item = content.createEl("div", { cls: "kai-metric-item" });
			item.createEl("span", { text: k, cls: "kai-metric-label" });
			item.createEl("span", { text: String(metrics[k]), cls: "kai-metric-value" });
		});
	}

	renderScheduleWidget(parent: HTMLElement) {
		const widget = parent.createEl("div", { cls: "kai-widget" });
		const header = widget.createEl("div", { cls: "kai-widget-header" });
		header.createEl("h3", { text: "Schedule" });

		const content = widget.createEl("div", { cls: "kai-widget-content" });

		if (this.dailyData.length === 0) {
			content.createEl("p", { text: "No daily notes found." });
			return;
		}

		const latest = this.dailyData[0];
		const schedule = latest.frontmatter.schedule;

		if (!schedule) {
			content.createEl("p", { text: "No schedule found in frontmatter." });
			return;
		}

		if (Array.isArray(schedule)) {
			schedule.forEach(s => {
				content.createEl("div", { text: `• ${s}`, cls: "kai-metric-item" });
			});
		} else {
			content.createEl("div", { text: String(schedule) });
		}
	}

	renderOutputsWidget(parent: HTMLElement) {
		const widget = parent.createEl("div", { cls: "kai-widget" });
		const header = widget.createEl("div", { cls: "kai-widget-header" });
		header.createEl("h3", { text: "Recent Outputs" });

		const content = widget.createEl("div", { cls: "kai-widget-content" });

		if (this.dailyData.length === 0) {
			content.createEl("p", { text: "No daily notes found." });
			return;
		}

		const latest = this.dailyData[0];
		const outputs = latest.frontmatter.outputs || latest.frontmatter.output;

		if (!outputs) {
			content.createEl("p", { text: "No outputs found in frontmatter." });
			return;
		}

		if (Array.isArray(outputs)) {
			outputs.forEach(o => {
				content.createEl("div", { text: `• ${o}`, cls: "kai-metric-item" });
			});
		} else {
			content.createEl("div", { text: String(outputs) });
		}
	}

	async onClose() {
		// Nothing to clean up
	}
}

export default class KaiCommandCenterPlugin extends Plugin {
	settings: KaiCommandCenterSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_KAI_DASHBOARD,
			(leaf) => new KaiDashboardView(leaf, this)
		);

		this.addRibbonIcon('layout-dashboard', 'Open KAI Command Center', () => {
			this.activateView();
		});

		this.addCommand({
			id: 'open-kai-dashboard',
			name: 'Open KAI Command Center',
			callback: () => {
				this.activateView();
			}
		});
	}

	async onunload() {
		// Clean up
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_KAI_DASHBOARD);

		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			leaf = workspace.getLeaf(true);
			if (leaf) {
				await leaf.setViewState({ type: VIEW_TYPE_KAI_DASHBOARD, active: true });
			}
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
