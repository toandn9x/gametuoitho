/**
 * KeyMapperUI - User interface for keyboard remapping
 */

import { KeyMapper } from "./keyMapper.js";

let keyMapper = null;

/**
 * KeyCaptureModal - Modal for capturing key presses
 */
class KeyCaptureModal {
    constructor(actionName, friendlyName, onCapture, onCancel) {
        this.actionName = actionName;
        this.friendlyName = friendlyName;
        this.onCapture = onCapture;
        this.onCancel = onCancel;
        this.modal = null;
        this.keyHandler = null;
        this.show();
    }

    show() {
        // Create modal overlay
        const modal = document.createElement('div');
        modal.className = 'key-capture-modal';
        modal.innerHTML = `
            <div class="key-capture-content">
                <h2>Add Key for ${this.friendlyName}</h2>
                <p>Press any key to map it...</p>
                <div class="captured-key-display" id="captured-key">Waiting...</div>
                <button class="btn btn-outline" id="cancel-capture">Cancel (Esc)</button>
            </div>
        `;

        document.body.appendChild(modal);

        // Listen for keydown
        const handleKeyCapture = (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Allow Escape to cancel
            if (e.code === 'Escape') {
                this.onCancel();
                this.close();
                return;
            }

            // Ignore modifier-only keys
            if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
                return;
            }

            // Ignore special keys that shouldn't be remapped
            if (e.code === 'F12' || e.code === 'F5') {
                return;
            }

            // Display captured key
            const friendlyKey = keyMapper.getFriendlyKeyName(e.code);
            document.getElementById('captured-key').textContent = friendlyKey;

            // Wait briefly then close
            setTimeout(() => {
                this.onCapture(e.code);
                this.close();
            }, 500);
        };

        document.addEventListener('keydown', handleKeyCapture, { capture: true });

        // Cancel button
        const cancelBtn = modal.querySelector('#cancel-capture');
        cancelBtn.onclick = () => {
            this.onCancel();
            this.close();
        };

        // Click outside to cancel
        modal.onclick = (e) => {
            if (e.target === modal) {
                this.onCancel();
                this.close();
            }
        };

        this.modal = modal;
        this.keyHandler = handleKeyCapture;
    }

    close() {
        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler, { capture: true });
        }
        if (this.modal) {
            this.modal.remove();
        }
    }
}

/**
 * Render the mapping list UI
 */
function renderMappingList() {
    const container = document.getElementById('mapping-list');
    if (!container) {
        console.error('KeyMapperUI: mapping-list element not found');
        return;
    }

    container.innerHTML = '';

    const allActions = keyMapper.getAllActions();
    console.log('KeyMapperUI: Rendering', allActions.length, 'actions');

    if (allActions.length === 0) {
        console.warn('KeyMapperUI: No actions found!');
        container.innerHTML = '<p style="color: var(--neon-yellow); padding: 10px;">No keyboard actions found. Please check console for errors.</p>';
        return;
    }

    for (const actionDef of allActions) {
        const mappedKeys = keyMapper.getKeysForAction(actionDef.action);

        const item = document.createElement('div');
        item.className = 'mapping-item';

        // Header with action name and add button
        const header = document.createElement('div');
        header.className = 'mapping-header';

        const actionName = document.createElement('span');
        actionName.className = 'action-name';
        actionName.textContent = actionDef.friendlyName;

        const addBtn = document.createElement('button');
        addBtn.className = 'btn-add-key';
        addBtn.textContent = '+ Add Key';
        addBtn.dataset.action = actionDef.action;
        addBtn.onclick = () => handleAddKey(actionDef.action, actionDef.friendlyName);

        header.appendChild(actionName);
        header.appendChild(addBtn);

        // Mapped keys chips
        const keysContainer = document.createElement('div');
        keysContainer.className = 'mapped-keys';

        for (const keyCode of mappedKeys) {
            const chip = document.createElement('span');
            chip.className = 'mapped-key-chip';

            const keyName = document.createElement('span');
            keyName.textContent = keyMapper.getFriendlyKeyName(keyCode);

            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-key-btn';
            removeBtn.textContent = '×';
            removeBtn.title = 'Remove this key';
            removeBtn.onclick = () => handleRemoveKey(actionDef.action, keyCode);

            chip.appendChild(keyName);
            chip.appendChild(removeBtn);
            keysContainer.appendChild(chip);
        }

        item.appendChild(header);
        item.appendChild(keysContainer);
        container.appendChild(item);
    }
}

/**
 * Handle adding a new key mapping
 */
function handleAddKey(actionName, friendlyName) {
    new KeyCaptureModal(
        actionName,
        friendlyName,
        (eventCode) => {
            // Check if key is already mapped elsewhere
            const existingAction = keyMapper.getActionForKey(eventCode);
            if (existingAction && existingAction !== actionName) {
                const existingDef = keyMapper.getAllActions().find(a => a.action === existingAction);
                const existingFriendly = existingDef ? existingDef.friendlyName : existingAction;

                if (!confirm(`Key "${keyMapper.getFriendlyKeyName(eventCode)}" is already mapped to "${existingFriendly}".\n\nReassign to "${friendlyName}"?`)) {
                    return;
                }
            }

            // Add the mapping
            const success = keyMapper.addKeyMapping(actionName, eventCode);
            if (success) {
                renderMappingList();
            } else {
                alert('Failed to add key mapping.');
            }
        },
        () => {
            // Cancelled
        }
    );
}

/**
 * Handle removing a key mapping
 */
function handleRemoveKey(actionName, eventCode) {
    const mappedKeys = keyMapper.getKeysForAction(actionName);

    // Warn if removing the last key (will reset to default)
    if (mappedKeys.length === 1) {
        const defaults = keyMapper.getDefaultKeysForAction(actionName);
        const defaultNames = defaults.map(k => keyMapper.getFriendlyKeyName(k)).join(', ');

        if (!confirm(`This is the last key. Removing it will reset to defaults: ${defaultNames}\n\nContinue?`)) {
            return;
        }
    }

    const success = keyMapper.removeKeyMapping(actionName, eventCode);
    if (success) {
        renderMappingList();
    }
}

/**
 * Handle reset to defaults
 */
function handleResetToDefaults() {
    if (!confirm('Reset all keyboard mappings to defaults?\n\nThis will remove all custom key bindings.')) {
        return;
    }

    keyMapper.resetToDefaults();
    renderMappingList();
}

/**
 * Initialize the keyboard mapper UI
 */
export function initKeyMapperUI() {
    try {
        console.log('KeyMapperUI: Initializing...');
        keyMapper = new KeyMapper();
        console.log('KeyMapperUI: KeyMapper created');

        // Render the mapping list
        renderMappingList();

        // Setup reset button
        const resetBtn = document.getElementById('reset-mappings-btn');
        if (resetBtn) {
            resetBtn.onclick = handleResetToDefaults;
            console.log('KeyMapperUI: Reset button handler attached');
        } else {
            console.error('KeyMapperUI: reset-mappings-btn not found');
        }

        console.log('KeyMapperUI: Initialization complete');
    } catch (error) {
        console.error('KeyMapperUI: Initialization failed:', error);

        // Show error in UI
        const container = document.getElementById('mapping-list');
        if (container) {
            container.innerHTML = `
                <p style="color: var(--arcade-red); padding: 10px; border: 2px solid var(--arcade-red);">
                    <strong>Error initializing keyboard mapper:</strong><br>
                    ${error.message}<br>
                    <small>Check browser console for details (F12)</small>
                </p>
            `;
        }
    }
}
