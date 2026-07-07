import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const UPDATE_INTERVAL_SECONDS = 2;
const PANEL_MEMORY_LABEL = '▦';
const PANEL_FILESYSTEM_LABEL = '🖴';
const WARNING_THRESHOLD = 70;
const CRITICAL_THRESHOLD = 90;

function _workSsdPaths() {
    const userName = GLib.get_user_name();

    return [
        `/run/media/${userName}/Work`,
        `/media/${userName}/Work`,
        '/mnt/Work',
        '/mnt/work',
        '/media/Work',
        '/work',
    ];
}

const STORAGE_FILESYSTEMS = [
    {
        name: 'Fedora SSD',
        paths: ['/'],
    },
    {
        name: 'Work SSD',
        paths: _workSsdPaths(),
    },
];

function _readMeminfo() {
    const [, contents] = GLib.file_get_contents('/proc/meminfo');
    const decoder = new TextDecoder('utf-8');
    const meminfo = new Map();

    for (const line of decoder.decode(contents).split('\n')) {
        const match = line.match(/^([A-Za-z_()]+):\s+(\d+)\s+kB$/);
        if (match)
            meminfo.set(match[1], Number.parseInt(match[2], 10));
    }

    const total = meminfo.get('MemTotal') ?? 0;
    const available = meminfo.get('MemAvailable') ?? 0;
    const used = Math.max(total - available, 0);
    const usedPercent = total > 0 ? Math.round(used / total * 100) : 0;

    const swapTotal = meminfo.get('SwapTotal') ?? 0;
    const swapFree = meminfo.get('SwapFree') ?? 0;
    const swapUsed = Math.max(swapTotal - swapFree, 0);
    const swapPercent = swapTotal > 0 ? Math.round(swapUsed / swapTotal * 100) : 0;

    return {
        total,
        available,
        used,
        usedPercent,
        swapTotal,
        swapUsed,
        swapPercent,
    };
}

function _formatKib(kib) {
    if (kib >= 1024 * 1024)
        return `${(kib / 1024 / 1024).toFixed(1)} GiB`;

    return `${Math.round(kib / 1024)} MiB`;
}

function _readFilesystemUsage(path = '/') {
    const file = Gio.File.new_for_path(path);
    const info = file.query_filesystem_info(
        [
            Gio.FILE_ATTRIBUTE_FILESYSTEM_SIZE,
            Gio.FILE_ATTRIBUTE_FILESYSTEM_FREE,
        ].join(','),
        null);

    const total = info.get_attribute_uint64(Gio.FILE_ATTRIBUTE_FILESYSTEM_SIZE);
    const free = info.get_attribute_uint64(Gio.FILE_ATTRIBUTE_FILESYSTEM_FREE);
    const used = Math.max(total - free, 0);
    const usedPercent = total > 0 ? Math.round(used / total * 100) : 0;

    return {
        path,
        total,
        free,
        used,
        usedPercent,
    };
}

function _readStorageUsage(storage) {
    let lastError = null;

    for (const path of storage.paths) {
        if (!GLib.file_test(path, GLib.FileTest.IS_DIR))
            continue;

        try {
            return {
                ..._readFilesystemUsage(path),
                name: storage.name,
                mounted: true,
            };
        } catch (error) {
            lastError = error;
        }
    }

    return {
        name: storage.name,
        paths: storage.paths,
        mounted: false,
        error: lastError,
    };
}

function _formatBytes(bytes) {
    const gib = 1024 * 1024 * 1024;
    const mib = 1024 * 1024;

    if (bytes >= gib)
        return `${(bytes / gib).toFixed(1)} GiB`;

    return `${Math.round(bytes / mib)} MiB`;
}

const MemoryUsageIndicator = GObject.registerClass(
class MemoryUsageIndicator extends PanelMenu.Button {
    constructor() {
        super(0.0, 'Memory Usage Widget');

        this._timeoutId = 0;

        this._panelBox = new St.BoxLayout({
            style_class: 'memory-usage-panel',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._panelBox);

        this._memoryIconLabel = new St.Label({
            style_class: 'memory-usage-label memory-usage-icon',
            text: PANEL_MEMORY_LABEL,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._memoryPercentLabel = new St.Label({
            style_class: 'memory-usage-label memory-usage-number mini-font',
            text: '--%',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._panelBox.add_child(this._memoryIconLabel);
        this._panelBox.add_child(this._memoryPercentLabel);

        this._storagePercentLabels = STORAGE_FILESYSTEMS.map(() => {
            const iconLabel = new St.Label({
                style_class: 'memory-usage-label memory-usage-icon',
                text: PANEL_FILESYSTEM_LABEL,
                y_align: Clutter.ActorAlign.CENTER,
            });
            const percentLabel = new St.Label({
                style_class: 'memory-usage-label memory-usage-number mini-font',
                text: '--%',
                y_align: Clutter.ActorAlign.CENTER,
            });

            this._panelBox.add_child(iconLabel);
            this._panelBox.add_child(percentLabel);

            return percentLabel;
        });

        this._ramItem = new PopupMenu.PopupMenuItem('RAM: --', {
            reactive: false,
            can_focus: false,
        });
        this._availableItem = new PopupMenu.PopupMenuItem('Available: --', {
            reactive: false,
            can_focus: false,
        });
        this._swapItem = new PopupMenu.PopupMenuItem('Swap: --', {
            reactive: false,
            can_focus: false,
        });
        this._storageItems = STORAGE_FILESYSTEMS.map(storage =>
            new PopupMenu.PopupMenuItem(`${storage.name}: --`, {
                reactive: false,
                can_focus: false,
            }));

        this.menu.addMenuItem(this._ramItem);
        this.menu.addMenuItem(this._availableItem);
        this.menu.addMenuItem(this._swapItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        for (const item of this._storageItems)
            this.menu.addMenuItem(item);

        this._update();
        this._timeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            UPDATE_INTERVAL_SECONDS,
            () => {
                this._update();
                return GLib.SOURCE_CONTINUE;
            });
    }

    destroy() {
        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = 0;
        }

        super.destroy();
    }

    _update() {
        let stats;
        let storageStats = [];

        try {
            stats = _readMeminfo();
        } catch (error) {
            console.error(`Memory Usage Widget: failed to read /proc/meminfo: ${error}`);
            this._memoryPercentLabel.text = '--%';
            for (const label of this._storagePercentLabels)
                label.text = '--%';
            this._setLevelClass('unknown');
            return;
        }

        storageStats = STORAGE_FILESYSTEMS.map(storage => {
            const usage = _readStorageUsage(storage);

            if (usage.error)
                console.error(`Memory Usage Widget: failed to read ${storage.name} usage: ${usage.error}`);

            return usage;
        });

        this._memoryPercentLabel.text = `${stats.usedPercent}%`;
        this._ramItem.label.text = `RAM: ${_formatKib(stats.used)} / ${_formatKib(stats.total)} (${stats.usedPercent}%)`;
        this._availableItem.label.text = `Available: ${_formatKib(stats.available)}`;

        if (stats.swapTotal > 0) {
            this._swapItem.label.text =
                `Swap: ${_formatKib(stats.swapUsed)} / ${_formatKib(stats.swapTotal)} (${stats.swapPercent}%)`;
        } else {
            this._swapItem.label.text = 'Swap: not configured';
        }

        storageStats.forEach((storage, index) => {
            if (storage.mounted) {
                this._storagePercentLabels[index].text = `${storage.usedPercent}%`;
                this._storageItems[index].label.text =
                    `${storage.name} (${storage.path}): ${_formatBytes(storage.used)} / ${_formatBytes(storage.total)} ` +
                    `(${storage.usedPercent}%)`;
            } else {
                this._storagePercentLabels[index].text = '--%';
                this._storageItems[index].label.text =
                    `${storage.name}: not mounted`;
            }
        });

        let highestUsedPercent = stats.usedPercent;

        for (const storage of storageStats) {
            if (storage.mounted)
                highestUsedPercent = Math.max(highestUsedPercent, storage.usedPercent);
        }

        if (highestUsedPercent >= CRITICAL_THRESHOLD)
            this._setLevelClass('critical');
        else if (highestUsedPercent >= WARNING_THRESHOLD)
            this._setLevelClass('warning');
        else
            this._setLevelClass('normal');
    }

    _setLevelClass(level) {
        for (const name of ['normal', 'warning', 'critical', 'unknown'])
            this.remove_style_class_name(`memory-usage-${name}`);

        this.add_style_class_name(`memory-usage-${level}`);
    }
});

export default class MemoryUsageExtension extends Extension {
    enable() {
        this._indicator = new MemoryUsageIndicator();
        Main.panel.addToStatusArea('memory-usage-widget', this._indicator, 0, 'right');
    }

    disable() {
        if (!this._indicator)
            return;

        Main.panel.menuManager.removeMenu(this._indicator.menu);
        this._indicator.destroy();
        this._indicator = null;
    }
}
