/**
 * KeyMapper - Global keyboard remapping for J2ME emulator
 * Allows users to customize key bindings with multiple keys per action
 */

const STORAGE_KEY = 'freej2me-keymapper-config';
const CONFIG_VERSION = 1;

// J2ME action definitions with friendly names and default keys
const ACTION_DEFINITIONS = [
    { action: 'UP', friendlyName: 'D-Pad Up', defaultKeys: ['ArrowUp'] },
    { action: 'DOWN', friendlyName: 'D-Pad Down', defaultKeys: ['ArrowDown'] },
    { action: 'LEFT', friendlyName: 'D-Pad Left', defaultKeys: ['ArrowLeft'] },
    { action: 'RIGHT', friendlyName: 'D-Pad Right', defaultKeys: ['ArrowRight'] },
    { action: 'OK', friendlyName: 'OK/Select', defaultKeys: ['Enter'] },
    { action: 'SOFT_LEFT', friendlyName: 'Left Soft Key', defaultKeys: ['F1'] },
    { action: 'SOFT_RIGHT', friendlyName: 'Right Soft Key', defaultKeys: ['F2'] },
    { action: 'MENU', friendlyName: 'Menu/Back', defaultKeys: ['Escape'] },
    { action: 'KEY_0', friendlyName: 'Number 0', defaultKeys: ['Digit0', 'Numpad0'] },
    { action: 'KEY_1', friendlyName: 'Number 1', defaultKeys: ['Digit1', 'Numpad1'] },
    { action: 'KEY_2', friendlyName: 'Number 2', defaultKeys: ['Digit2', 'Numpad2'] },
    { action: 'KEY_3', friendlyName: 'Number 3', defaultKeys: ['Digit3', 'Numpad3'] },
    { action: 'KEY_4', friendlyName: 'Number 4', defaultKeys: ['Digit4', 'Numpad4'] },
    { action: 'KEY_5', friendlyName: 'Number 5', defaultKeys: ['Digit5', 'Numpad5'] },
    { action: 'KEY_6', friendlyName: 'Number 6', defaultKeys: ['Digit6', 'Numpad6'] },
    { action: 'KEY_7', friendlyName: 'Number 7', defaultKeys: ['Digit7', 'Numpad7'] },
    { action: 'KEY_8', friendlyName: 'Number 8', defaultKeys: ['Digit8', 'Numpad8'] },
    { action: 'KEY_9', friendlyName: 'Number 9', defaultKeys: ['Digit9', 'Numpad9'] },
    { action: 'STAR', friendlyName: 'Star (*)', defaultKeys: ['NumpadMultiply'] },
    { action: 'HASH', friendlyName: 'Hash (#)', defaultKeys: ['NumpadDivide'] },
];

/**
 * KeyMapper class - manages global keyboard mappings
 */
export class KeyMapper {
    constructor() {
        this.mappings = {};
        this.reverseMap = new Map(); // eventCode -> action name
        this.load();
    }

    /**
     * Get default mappings object
     */
    _getDefaultMappings() {
        const defaults = {};
        for (const def of ACTION_DEFINITIONS) {
            defaults[def.action] = [...def.defaultKeys];
        }
        return defaults;
    }

    /**
     * Build reverse mapping (eventCode -> action) for fast lookups
     */
    _buildReverseMap() {
        this.reverseMap.clear();
        for (const [action, keys] of Object.entries(this.mappings)) {
            for (const key of keys) {
                this.reverseMap.set(key, action);
            }
        }
    }

    /**
     * Get the J2ME action name for a physical key code
     * @param {string} eventCode - The event.code (e.g., 'ArrowUp', 'KeyW')
     * @returns {string|null} - The action name (e.g., 'UP') or null if not mapped
     */
    getActionForKey(eventCode) {
        return this.reverseMap.get(eventCode) || null;
    }

    /**
     * Get all physical keys mapped to an action
     * @param {string} actionName - The action name (e.g., 'UP')
     * @returns {string[]} - Array of event codes
     */
    getKeysForAction(actionName) {
        return this.mappings[actionName] || [];
    }

    /**
     * Get the default keys for an action (used for keycode resolution)
     * @param {string} actionName - The action name
     * @returns {string[]} - Array of default event codes
     */
    getDefaultKeysForAction(actionName) {
        const def = ACTION_DEFINITIONS.find(d => d.action === actionName);
        return def ? def.defaultKeys : [];
    }

    /**
     * Add a key mapping to an action
     * @param {string} actionName - The action name
     * @param {string} eventCode - The event.code to map
     * @returns {boolean} - Success status
     */
    addKeyMapping(actionName, eventCode) {
        // Validate action exists
        if (!ACTION_DEFINITIONS.find(d => d.action === actionName)) {
            console.error(`Invalid action name: ${actionName}`);
            return false;
        }

        // Initialize array if needed
        if (!this.mappings[actionName]) {
            this.mappings[actionName] = [];
        }

        // Prevent duplicates
        if (this.mappings[actionName].includes(eventCode)) {
            console.warn(`Key ${eventCode} already mapped to ${actionName}`);
            return false;
        }

        // Remove from other actions if already mapped (prevent conflicts)
        this._removeKeyFromAllActions(eventCode);

        // Add the mapping
        this.mappings[actionName].push(eventCode);
        this._buildReverseMap();
        this.save();
        return true;
    }

    /**
     * Remove a specific key from an action mapping
     * @param {string} actionName - The action name
     * @param {string} eventCode - The event.code to remove
     * @returns {boolean} - Success status
     */
    removeKeyMapping(actionName, eventCode) {
        if (!this.mappings[actionName]) {
            return false;
        }

        const index = this.mappings[actionName].indexOf(eventCode);
        if (index === -1) {
            return false;
        }

        // Remove the key
        this.mappings[actionName].splice(index, 1);

        // Clean up empty arrays
        if (this.mappings[actionName].length === 0) {
            // Reset to default instead of leaving empty
            const defaults = this.getDefaultKeysForAction(actionName);
            if (defaults.length > 0) {
                this.mappings[actionName] = [...defaults];
            }
        }

        this._buildReverseMap();
        this.save();
        return true;
    }

    /**
     * Remove a key from all actions (helper for preventing conflicts)
     * @private
     */
    _removeKeyFromAllActions(eventCode) {
        for (const keys of Object.values(this.mappings)) {
            const index = keys.indexOf(eventCode);
            if (index !== -1) {
                keys.splice(index, 1);
            }
        }
    }

    /**
     * Reset all mappings to defaults
     */
    resetToDefaults() {
        this.mappings = this._getDefaultMappings();
        this._buildReverseMap();
        this.save();
    }

    /**
     * Save current state to localStorage
     */
    save() {
        try {
            const config = {
                version: CONFIG_VERSION,
                mappings: this.mappings
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
        } catch (error) {
            console.error('Failed to save key mappings:', error);
        }
    }

    /**
     * Load from localStorage
     */
    load() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const config = JSON.parse(stored);

                // Validate version
                if (config.version === CONFIG_VERSION && config.mappings) {
                    this.mappings = config.mappings;
                } else {
                    // Invalid or old version, reset to defaults
                    this.resetToDefaults();
                }
            } else {
                // First time, use defaults
                this.resetToDefaults();
            }
        } catch (error) {
            console.error('Failed to load key mappings, using defaults:', error);
            this.resetToDefaults();
        }

        this._buildReverseMap();
    }

    /**
     * Get all available J2ME actions with metadata
     * @returns {Array<{action: string, friendlyName: string, defaultKeys: string[]}>}
     */
    getAllActions() {
        return ACTION_DEFINITIONS.map(def => ({
            action: def.action,
            friendlyName: def.friendlyName,
            defaultKeys: [...def.defaultKeys]
        }));
    }

    /**
     * Get friendly key name for display
     * @param {string} eventCode - The event.code
     * @returns {string} - Human-readable key name
     */
    getFriendlyKeyName(eventCode) {
        // Convert event codes to friendly names
        const friendlyNames = {
            'ArrowUp': '↑',
            'ArrowDown': '↓',
            'ArrowLeft': '←',
            'ArrowRight': '→',
            'Enter': 'Enter',
            'Escape': 'Esc',
            'Space': 'Space',
            'Backspace': 'Backspace',
            'Delete': 'Delete',
            'F1': 'F1',
            'F2': 'F2',
            'F3': 'F3',
            'NumpadMultiply': '*',
            'NumpadDivide': '#',
        };

        // Handle Digit keys (Digit0 -> 0)
        if (eventCode.startsWith('Digit')) {
            return eventCode.substring(5);
        }

        // Handle Numpad keys (Numpad0 -> Num 0)
        if (eventCode.startsWith('Numpad')) {
            const num = eventCode.substring(6);
            return `Num ${num}`;
        }

        // Handle letter keys (KeyW -> W)
        if (eventCode.startsWith('Key')) {
            return eventCode.substring(3);
        }

        // Use friendly name if available, otherwise return as-is
        return friendlyNames[eventCode] || eventCode;
    }
}
