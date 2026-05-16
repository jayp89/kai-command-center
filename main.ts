import { App, ItemView, Plugin, TFile, WorkspaceLeaf, moment } from 'obsidian';

// ─── Constants ────────────────────────────────────────────────────────────────

const VIEW_TYPE_KAI = 'kai-command-center-view';
const DAILY_NOTES_PATH = '00 Human/10 Daily Notes/';
const INBOX_PATH = '00 Human/00 Inbox/';

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface DailyNote {
	date: string;           // YYYY-MM-DD
	filePath: string;
	oneThing: string;
	priorities: string[];
	frogs: CheckItem[];
	tasks: CheckItem[];
	quickWins: CheckItem[];
	calendar: CalendarEntry[];
	metrics: MetricEntry[];
	activityLog: string[];
	wins: string[];
	blockers: string[];
	reflection: string;
}

interface CheckItem {
	text: string;
	checked: boolean;
}

interface CalendarEntry {
	time: string;
	label: string;
	category: string;
}

interface MetricEntry {
	label: string;
	value: string;
}

// ─── Parser ───────────────────────────────────────────────────────────────────

function parseSection(content: string, heading: string): string {
	// Matches ## heading and captures everything until the next ## heading or end
	const regex = new RegExp(`##\\s+${escapeRegex(heading)}[\\s\\S]*?\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i');
	const match = content.match(regex);
	return match ? match[1].trim() : '';
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseCheckItems(block: string): CheckItem[] {
	return block
		.split('\n')
		.filter(l => l.match(/^- \[[ xX]\]/))
		.map(l => ({
			checked: l.match(/^- \[[xX]\]/) !== null,
			text: l.replace(/^- \[[ xX]\]\s*/, '').trim()
		}));
}

function parseBullets(block: string): string[] {
	return block
		.split('\n')
		.filter(l => l.match(/^[-•]\s/) && !l.match(/^- \[/))
		.map(l => l.replace(/^[-•]\s+/, '').trim())
		.filter(Boolean);
}

function parseCalendar(block: string): CalendarEntry[] {
	return block
		.split('\n')
		.filter(l => l.match(/^\d{1,2}:\d{2}/))
		.map(l => {
			const timeMatch = l.match(/^(\d{1,2}:\d{2}(?:-\d{1,2}:\d{2})?)/);
			const time = timeMatch ? timeMatch[1] : '';
			const rest = l.replace(/^\d{1,2}:\d{2}(?:-\d{1,2}:\d{2})?\s*/, '').trim();
			// Detect category keywords
			let category = 'General';
			if (/content|film|record|edit|post|youtube/i.test(rest)) category = 'Content';
			else if (/admin|email|inbox|triage/i.test(rest)) category = 'Admin';
			else if (/deep work|focus|build|code|write/i.test(rest)) category = 'Deep Work';
			else if (/meet|call|sync|review/i.test(rest)) category = 'Meeting';
			return { time, label: rest, category };
		})
		.filter(e => e.time);
}

function parseMetrics(block: string): MetricEntry[] {
	return block
		.split('\n')
		.filter(l => l.match(/^[-•]\s/) && l.includes(':'))
		.map(l => {
			const clean = l.replace(/^[-•]\s+/, '').trim();
			const colonIdx = clean.indexOf(':');
			return {
				label: clean.substring(0, colonIdx).trim(),
				value: clean.substring(colonIdx + 1).trim()
			};
		})
		.filter(e => e.label && e.value);
}

function parseFocus(block: string): { oneThing: string; priorities: string[] } {
	const lines = block.split('\n').filter(Boolean);
	let oneThing = '';
	const priorities: string[] = [];
	for (const line of lines) {
		const clean = line.replace(/^[-•*]\s*\*{0,2}(ONE Thing:|Priority \d+:)\*{0,2}\s*/i, '').trim();
		if (/ONE Thing/i.test(line)) oneThing = clean;
		else if (/Priority/i.test(line)) priorities.push(clean);
	}
	return { oneThing, priorities };
}

async function parseDailyNote(app: App, file: TFile): Promise<DailyNote> {
	const content = await app.vault.read(file);

	// Section headings as they appear in the template (emoji + text)
	const focusRaw = parseSection(content, '🎯 Today\'s Focus');
	const { oneThing, priorities } = parseFocus(focusRaw);

	const calBlock = parseSection(content, '📅 Calendar');
	const metricsBlock = parseSection(content, '📈 Metrics Snapshot');
	const actBlock = parseSection(content, '📥 Activity Log');
	const eodBlock = parseSection(content, '🧠 End of Day');

	// Wins/Blockers/Reflection live inside End of Day
	const winsBlock = eodBlock.match(/###\s+Wins\s*\n([\s\S]*?)(?=###|$)/i)?.[1] ?? '';
	const blockersBlock = eodBlock.match(/###\s+Blockers\s*\n([\s\S]*?)(?=###|$)/i)?.[1] ?? '';
	const reflectionBlock = eodBlock.match(/###\s+Reflection\s*\n([\s\S]*?)(?=###|$)/i)?.[1] ?? '';

	return {
		date: file.basename,
		filePath: file.path,
		oneThing,
		priorities,
		frogs: parseCheckItems(parseSection(content, '🐸 Frogs to Eat')),
		tasks: parseCheckItems(parseSection(content, '✅ Today\'s Tasks')),
		quickWins: parseCheckItems(parseSection(content, '⚡ Quick Wins')),
		calendar: parseCalendar(calBlock),
		metrics: parseMetrics(metricsBlock),
		activityLog: parseBullets(actBlock),
		wins: parseBullets(winsBlock),
		blockers: parseBullets(blockersBlock),
		reflection: reflectionBlock.replace(/^>\s*/gm, '').trim()
	};
}

// ─── View ─────────────────────────────────────────────────────────────────────

class KaiCommandCenterView extends ItemView {
	plugin: KaiCommandCenterPlugin;
	today: DailyNote | null = null;
	history: DailyNote[] = [];   // last 30 days for heatmap/charts
	activeTab = 'overview';
	captureInput = '';
	private refreshTimer: number | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: KaiCommandCenterPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() { return VIEW_TYPE_KAI; }
	getDisplayText() { return 'KAI Command Center'; }
	getIcon() { return 'layout-dashboard'; }

	async onOpen() {
		await this.loadData();
		this.render();
		// Refresh when vault changes
		this.registerEvent(
			this.app.metadataCache.on('changed', () => {
				if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
				this.refreshTimer = window.setTimeout(async () => {
					await this.loadData();
					this.render();
				}, 800);
			})
		);
	}

	async onClose() {
		if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
	}

	async loadData() {
		const files = this.app.vault.getMarkdownFiles()
			.filter(f => f.path.startsWith(DAILY_NOTES_PATH) && f.basename.match(/^\d{4}-\d{2}-\d{2}$/))
			.sort((a, b) => b.basename.localeCompare(a.basename));

		const recent = files.slice(0, 30);
		const parsed = await Promise.all(recent.map(f => parseDailyNote(this.app, f)));
		this.history = parsed;
		this.today = parsed[0] ?? null;
	}

	// ── Render root ──────────────────────────────────────────────────────────

	render() {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.className = 'kai-root';

		// Tab bar
		const tabBar = container.createEl('div', { cls: 'kai-tab-bar' });
		const tabs = [
			{ id: 'overview', label: '⌂ Overview' },
			{ id: 'focus', label: '🎯 Focus' },
			{ id: 'schedule', label: '📅 Schedule' },
			{ id: 'metrics', label: '📈 Metrics' },
			{ id: 'activity', label: '🔥 Activity' },
			{ id: 'capture', label: '⚡ Capture' },
		];
		tabs.forEach(t => {
			const btn = tabBar.createEl('button', {
				text: t.label,
				cls: `kai-tab-btn ${this.activeTab === t.id ? 'active' : ''}`
			});
			btn.onclick = () => { this.activeTab = t.id; this.render(); };
		});

		// Date badge
		const dateBadge = tabBar.createEl('span', {
			text: moment().format('ddd, MMM D'),
			cls: 'kai-date-badge'
		});

		// Content area
		const content = container.createEl('div', { cls: 'kai-content' });

		switch (this.activeTab) {
			case 'overview': this.renderOverview(content); break;
			case 'focus': this.renderFocus(content); break;
			case 'schedule': this.renderSchedule(content); break;
			case 'metrics': this.renderMetrics(content); break;
			case 'activity': this.renderActivity(content); break;
			case 'capture': this.renderCapture(content); break;
		}
	}

	// ── Overview ─────────────────────────────────────────────────────────────

	renderOverview(parent: HTMLElement) {
		const grid = parent.createEl('div', { cls: 'kai-overview-grid' });

		// ── Focus card
		const focusCard = this.createCard(grid, '🎯 Today\'s ONE Thing');
		if (this.today?.oneThing) {
			focusCard.createEl('p', { text: this.today.oneThing, cls: 'kai-one-thing' });
			if (this.today.priorities.length) {
				const ul = focusCard.createEl('ul', { cls: 'kai-priority-list' });
				this.today.priorities.forEach((p, i) => {
					ul.createEl('li', { text: `${i + 2}. ${p}` });
				});
			}
		} else {
			focusCard.createEl('p', { text: 'No focus set — run /today', cls: 'kai-muted' });
		}

		// ── Tasks card
		const taskCard = this.createCard(grid, '✅ Today\'s Tasks');
		const allTasks = [...(this.today?.frogs ?? []), ...(this.today?.tasks ?? [])];
		if (allTasks.length) {
			this.renderChecklist(taskCard, allTasks);
		} else {
			taskCard.createEl('p', { text: 'No tasks — run /today', cls: 'kai-muted' });
		}

		// ── Schedule card
		const schedCard = this.createCard(grid, '📅 Schedule');
		if (this.today?.calendar.length) {
			this.today.calendar.slice(0, 6).forEach(e => {
				const row = schedCard.createEl('div', { cls: 'kai-sched-row' });
				row.createEl('span', { text: e.time, cls: 'kai-sched-time' });
				row.createEl('span', { text: e.label, cls: 'kai-sched-label' });
				row.createEl('span', { text: e.category, cls: `kai-sched-tag kai-tag-${e.category.toLowerCase().replace(' ', '-')}` });
			});
		} else {
			schedCard.createEl('p', { text: 'No calendar entries today', cls: 'kai-muted' });
		}

		// ── Metrics snapshot card
		const metCard = this.createCard(grid, '📈 Metrics');
		if (this.today?.metrics.length) {
			this.today.metrics.forEach(m => {
				const row = metCard.createEl('div', { cls: 'kai-metric-row' });
				row.createEl('span', { text: m.label, cls: 'kai-metric-label' });
				row.createEl('span', { text: m.value, cls: 'kai-metric-value' });
			});
		} else {
			metCard.createEl('p', { text: 'No metrics today — run /closeday', cls: 'kai-muted' });
		}

		// ── Wins card
		const winsCard = this.createCard(grid, '🏆 Wins');
		const wins = this.today?.wins ?? [];
		if (wins.length) {
			wins.forEach(w => winsCard.createEl('p', { text: `• ${w}`, cls: 'kai-win-item' }));
		} else {
			winsCard.createEl('p', { text: 'No wins logged yet', cls: 'kai-muted' });
		}

		// ── Blockers card
		const blockCard = this.createCard(grid, '🚧 Blockers');
		const blockers = this.today?.blockers ?? [];
		if (blockers.length) {
			blockers.forEach(b => blockCard.createEl('p', { text: `• ${b}`, cls: 'kai-blocker-item' }));
		} else {
			blockCard.createEl('p', { text: 'No blockers', cls: 'kai-muted' });
		}
	}

	// ── Focus ────────────────────────────────────────────────────────────────

	renderFocus(parent: HTMLElement) {
		if (!this.today) { parent.createEl('p', { text: 'No daily note found for today.', cls: 'kai-muted kai-center' }); return; }

		const card = this.createCard(parent, `🎯 Focus — ${this.today.date}`, 'kai-card kai-card-full');

		if (this.today.oneThing) {
			card.createEl('div', { cls: 'kai-one-thing-block' }).createEl('p', { text: this.today.oneThing });
		}

		if (this.today.priorities.length) {
			card.createEl('h4', { text: 'Priorities' });
			const ul = card.createEl('ul', { cls: 'kai-priority-list' });
			this.today.priorities.forEach((p, i) => ul.createEl('li', { text: `${i + 2}. ${p}` }));
		}

		card.createEl('h4', { text: '🐸 Frogs to Eat' });
		this.renderChecklist(card, this.today.frogs.length ? this.today.frogs : []);

		card.createEl('h4', { text: '✅ Tasks' });
		this.renderChecklist(card, this.today.tasks);

		card.createEl('h4', { text: '⚡ Quick Wins' });
		this.renderChecklist(card, this.today.quickWins);

		if (this.today.reflection) {
			card.createEl('h4', { text: '💭 Reflection' });
			card.createEl('blockquote', { text: this.today.reflection, cls: 'kai-reflection' });
		}
	}

	// ── Schedule ─────────────────────────────────────────────────────────────

	renderSchedule(parent: HTMLElement) {
		const card = this.createCard(parent, '📅 Today\'s Schedule', 'kai-card kai-card-full');

		if (!this.today?.calendar.length) {
			card.createEl('p', { text: 'No calendar entries. Add time blocks to your daily note under ## 📅 Calendar', cls: 'kai-muted' });
			return;
		}

		this.today.calendar.forEach(e => {
			const row = card.createEl('div', { cls: 'kai-sched-row-full' });
			row.createEl('span', { text: e.time, cls: 'kai-sched-time' });
			const detail = row.createEl('div', { cls: 'kai-sched-detail' });
			detail.createEl('span', { text: e.label, cls: 'kai-sched-label' });
			detail.createEl('span', { text: e.category, cls: `kai-sched-tag kai-tag-${e.category.toLowerCase().replace(' ', '-')}` });
		});
	}

	// ── Metrics ──────────────────────────────────────────────────────────────

	renderMetrics(parent: HTMLElement) {
		// Today's metrics
		const todayCard = this.createCard(parent, `📈 Metrics Snapshot — ${this.today?.date ?? 'Today'}`, 'kai-card kai-card-full');

		if (this.today?.metrics.length) {
			this.today.metrics.forEach(m => {
				const row = todayCard.createEl('div', { cls: 'kai-metric-row kai-metric-row-lg' });
				row.createEl('span', { text: m.label, cls: 'kai-metric-label' });
				row.createEl('span', { text: m.value, cls: 'kai-metric-value' });
			});
		} else {
			todayCard.createEl('p', { text: 'No metrics logged today. Run /closeday to log metrics under ## 📈 Metrics Snapshot', cls: 'kai-muted' });
		}

		// History table
		if (this.history.length > 1) {
			const histCard = this.createCard(parent, '📊 Metrics History (Last 30 Days)', 'kai-card kai-card-full');

			// Collect all unique metric labels across history
			const allLabels = new Set<string>();
			this.history.forEach(d => d.metrics.forEach(m => allLabels.add(m.label)));

			if (allLabels.size === 0) {
				histCard.createEl('p', { text: 'No historical metrics found yet.', cls: 'kai-muted' });
				return;
			}

			const table = histCard.createEl('table', { cls: 'kai-metrics-table' });
			const thead = table.createEl('thead');
			const headerRow = thead.createEl('tr');
			headerRow.createEl('th', { text: 'Date' });
			allLabels.forEach(l => headerRow.createEl('th', { text: l }));

			const tbody = table.createEl('tbody');
			this.history.forEach(day => {
				const tr = tbody.createEl('tr');
				tr.createEl('td', { text: day.date, cls: 'kai-table-date' });
				allLabels.forEach(label => {
					const m = day.metrics.find(m => m.label === label);
					tr.createEl('td', { text: m?.value ?? '—', cls: m ? '' : 'kai-muted' });
				});
			});
		}
	}

	// ── Activity Heatmap ─────────────────────────────────────────────────────

	renderActivity(parent: HTMLElement) {
		const card = this.createCard(parent, '🔥 Activity Heatmap', 'kai-card kai-card-full');
		card.createEl('p', { text: 'Each cell = one day. Darker = more activity logged.', cls: 'kai-muted kai-heatmap-legend' });

		const heatmap = card.createEl('div', { cls: 'kai-heatmap' });

		// Build a map: date string → activity count
		const activityMap = new Map<string, number>();
		this.history.forEach(d => {
			const count = d.activityLog.length + d.tasks.filter(t => t.checked).length + d.frogs.filter(f => f.checked).length;
			activityMap.set(d.date, count);
		});

		// Render last 12 weeks (84 days)
		const today = moment();
		// Start from the Sunday 12 weeks ago
		const startDate = today.clone().subtract(83, 'days');

		// Day-of-week labels
		const dowRow = heatmap.createEl('div', { cls: 'kai-heatmap-labels' });
		['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach(d => {
			dowRow.createEl('span', { text: d, cls: 'kai-heatmap-dow' });
		});

		const grid = heatmap.createEl('div', { cls: 'kai-heatmap-grid' });

		// Find max for scaling
		const maxActivity = Math.max(1, ...Array.from(activityMap.values()));

		for (let i = 0; i < 84; i++) {
			const date = startDate.clone().add(i, 'days');
			const dateStr = date.format('YYYY-MM-DD');
			const count = activityMap.get(dateStr) ?? 0;
			const intensity = Math.min(4, Math.floor((count / maxActivity) * 4));
			const isToday = dateStr === today.format('YYYY-MM-DD');
			const isFuture = date.isAfter(today);

			const cell = grid.createEl('div', {
				cls: `kai-heatmap-cell kai-heat-${isFuture ? 'future' : intensity} ${isToday ? 'kai-heat-today' : ''}`,
				attr: { title: isFuture ? '' : `${dateStr}: ${count} activities` }
			});
		}

		// Stats below heatmap
		const statsRow = card.createEl('div', { cls: 'kai-heatmap-stats' });
		const totalDays = this.history.length;
		const activeDays = this.history.filter(d => d.activityLog.length > 0 || d.tasks.some(t => t.checked)).length;
		const totalTasks = this.history.reduce((sum, d) => sum + d.tasks.filter(t => t.checked).length, 0);
		const totalFrogs = this.history.reduce((sum, d) => sum + d.frogs.filter(f => f.checked).length, 0);

		[
			{ label: 'Days tracked', value: String(totalDays) },
			{ label: 'Active days', value: String(activeDays) },
			{ label: 'Tasks completed', value: String(totalTasks) },
			{ label: 'Frogs eaten', value: String(totalFrogs) },
		].forEach(s => {
			const stat = statsRow.createEl('div', { cls: 'kai-stat-block' });
			stat.createEl('span', { text: s.value, cls: 'kai-stat-value' });
			stat.createEl('span', { text: s.label, cls: 'kai-stat-label' });
		});
	}

	// ── Quick Capture ────────────────────────────────────────────────────────

	renderCapture(parent: HTMLElement) {
		const card = this.createCard(parent, '⚡ Quick Capture', 'kai-card kai-card-full');
		card.createEl('p', { text: 'Captured items are appended to your inbox for /new to route.', cls: 'kai-muted' });

		const inputRow = card.createEl('div', { cls: 'kai-capture-row' });
		const input = inputRow.createEl('textarea', {
			cls: 'kai-capture-input',
			attr: { placeholder: 'Capture a thought, task, link, or note...', rows: '4' }
		}) as HTMLTextAreaElement;
		input.value = this.captureInput;
		input.oninput = () => { this.captureInput = input.value; };

		const btn = card.createEl('button', { text: '→ Send to Inbox', cls: 'kai-capture-btn' });
		btn.onclick = async () => {
			const text = input.value.trim();
			if (!text) return;
			await this.appendToInbox(text);
			input.value = '';
			this.captureInput = '';
			btn.textContent = '✓ Captured!';
			setTimeout(() => { btn.textContent = '→ Send to Inbox'; }, 2000);
		};

		// Recent activity log
		if (this.today?.activityLog.length) {
			const logCard = this.createCard(parent, '📥 Today\'s Activity Log');
			this.today.activityLog.forEach(entry => {
				logCard.createEl('div', { text: `• ${entry}`, cls: 'kai-log-entry' });
			});
		}
	}

	async appendToInbox(text: string) {
		const timestamp = moment().format('YYYY-MM-DD HH:mm');
		const fileName = `${INBOX_PATH}Capture - ${timestamp}.md`;
		const content = `---\ntype: inbox\ncaptured: "${timestamp}"\nsource: kai-command-center\nstatus: raw\ntags: []\n---\n\n# Capture — ${timestamp}\n\n## Raw Thought\n> ${text}\n\n## Why This Matters\n>\n\n## Next Action\n- [ ] \n`;
		await this.app.vault.create(fileName, content);

		// Also append to today's activity log
		const todayPath = `00 Human/10 Daily Notes/${moment().format('YYYY-MM-DD')}.md`;
		const todayFile = this.app.vault.getAbstractFileByPath(todayPath) as TFile;
		if (todayFile) {
			let todayContent = await this.app.vault.read(todayFile);
			const logEntry = `- [${moment().format('HH:mm')}] Quick Capture → Inbox: "${text.substring(0, 60)}${text.length > 60 ? '…' : ''}"`;
			if (todayContent.includes('## 📥 Activity Log')) {
				todayContent = todayContent.replace('## 📥 Activity Log', `## 📥 Activity Log\n${logEntry}`);
			} else {
				todayContent += `\n${logEntry}`;
			}
			await this.app.vault.modify(todayFile, todayContent);
		}
	}

	// ── Helpers ──────────────────────────────────────────────────────────────

	createCard(parent: HTMLElement, title: string, cls = 'kai-card'): HTMLElement {
		const card = parent.createEl('div', { cls });
		card.createEl('h3', { text: title, cls: 'kai-card-title' });
		return card;
	}

	renderChecklist(parent: HTMLElement, items: CheckItem[]) {
		if (!items.length) {
			parent.createEl('p', { text: 'None', cls: 'kai-muted' });
			return;
		}
		const list = parent.createEl('ul', { cls: 'kai-checklist' });
		items.forEach(item => {
			const li = list.createEl('li', { cls: `kai-check-item ${item.checked ? 'kai-checked' : ''}` });
			li.createEl('span', { cls: `kai-checkbox ${item.checked ? 'kai-checkbox-done' : ''}`, text: item.checked ? '✓' : '○' });
			li.createEl('span', { text: item.text, cls: 'kai-check-text' });
		});
	}
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default class KaiCommandCenterPlugin extends Plugin {
	async onload() {
		this.registerView(VIEW_TYPE_KAI, (leaf) => new KaiCommandCenterView(leaf, this));

		this.addRibbonIcon('layout-dashboard', 'Open KAI Command Center', () => {
			this.activateView();
		});

		this.addCommand({
			id: 'open-kai-command-center',
			name: 'Open KAI Command Center',
			callback: () => this.activateView()
		});
	}

	async activateView() {
		const { workspace } = this.app;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_KAI);
		if (leaves.length > 0) {
			workspace.revealLeaf(leaves[0]);
			return;
		}
		const leaf = workspace.getLeaf(true);
		if (leaf) {
			await leaf.setViewState({ type: VIEW_TYPE_KAI, active: true });
			workspace.revealLeaf(leaf);
		}
	}
}
