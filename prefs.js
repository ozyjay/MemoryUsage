// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const SENSOR_HISTORY_ENABLED_KEY = 'sensor-history-enabled';

export default class SystemUsagePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({
            title: 'System Usage Monitor',
            icon_name: 'utilities-system-monitor-symbolic',
        });
        const group = new Adw.PreferencesGroup({
            title: 'Sensor history',
            description: 'Control whether recent system readings are written to disk.',
        });
        const historyRow = new Adw.SwitchRow({
            title: 'Record sensor history',
            subtitle: 'Write a snapshot every two seconds and retain seven daily log files',
        });

        settings.bind(
            SENSOR_HISTORY_ENABLED_KEY,
            historyRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT);

        group.add(historyRow);
        page.add(group);
        window.add(page);
    }
}
