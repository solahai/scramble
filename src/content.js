const browserAPI = (typeof browser !== 'undefined' ? browser : chrome);

// ========== State ==========
let scrambleToolbar = null;
let scrambleToast = null;
let undoStack = [];
const MAX_UNDO = 10;

// ========== Message Listener ==========
browserAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') {
    sendResponse({ success: true });
    return;
  }

  if (request.action === 'enhanceText') {
    handleEnhanceText(request.promptId, request.selectedText)
      .then(() => sendResponse({ success: true }))
      .catch(error => {
        showToast(error.message, 'error');
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === 'triggerFromShortcut') {
    const selection = window.getSelection();
    const selectedText = selection?.toString()?.trim();
    if (selectedText) {
      handleEnhanceText(request.promptId, selectedText)
        .then(() => sendResponse({ success: true }))
        .catch(error => {
          showToast(error.message, 'error');
          sendResponse({ success: false, error: error.message });
        });
    } else {
      showToast('Please select some text first.', 'warning');
      sendResponse({ success: false, error: 'No text selected' });
    }
    return true;
  }

  if (request.action === 'showToolbar') {
    const selection = window.getSelection();
    const selectedText = selection?.toString()?.trim();
    if (selectedText && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      showFloatingToolbar(rect);
    } else {
      showToast('Select some text to use Scramble.', 'info');
    }
    sendResponse({ success: true });
    return;
  }
});

// ========== Floating Toolbar ==========

function createFloatingToolbar() {
  if (scrambleToolbar) {
    scrambleToolbar.remove();
  }

  const toolbar = document.createElement('div');
  toolbar.id = 'scramble-toolbar';
  toolbar.innerHTML = `
    <div id="scramble-toolbar-inner">
      <div id="scramble-toolbar-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>
        <span>Scramble</span>
        <button id="scramble-toolbar-close" title="Close">&times;</button>
      </div>
      <div id="scramble-toolbar-actions"></div>
      <div id="scramble-toolbar-footer">
        <button id="scramble-undo-btn" title="Undo last change" disabled>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
          </svg>
          Undo
        </button>
      </div>
    </div>
  `;

  // Inject styles
  if (!document.getElementById('scramble-styles')) {
    const style = document.createElement('style');
    style.id = 'scramble-styles';
    style.textContent = getScrambleStyles();
    document.head.appendChild(style);
  }

  document.body.appendChild(toolbar);
  scrambleToolbar = toolbar;

  // Close button
  toolbar.querySelector('#scramble-toolbar-close').addEventListener('click', () => {
    hideFloatingToolbar();
  });

  // Undo button
  toolbar.querySelector('#scramble-undo-btn').addEventListener('click', () => {
    performUndo();
  });

  // Load prompts and create buttons
  loadToolbarActions();

  return toolbar;
}

async function loadToolbarActions() {
  try {
    const response = await browserAPI.runtime.sendMessage({ action: 'getPrompts' });
    if (response.success) {
      const actionsContainer = document.getElementById('scramble-toolbar-actions');
      if (!actionsContainer) return;
      actionsContainer.innerHTML = '';

      const icons = {
        fix_grammar: '✓',
        improve_writing: '✨',
        make_professional: '💼',
        simplify: '📝',
        summarize: '📋',
        expand: '📖',
        bullet_points: '•',
        make_friendly: '😊',
        make_concise: '✂️',
        translate_english: '🌐',
      };

      response.prompts.forEach(prompt => {
        const btn = document.createElement('button');
        btn.className = 'scramble-action-btn';
        btn.dataset.promptId = prompt.id;
        const icon = icons[prompt.id] || '⚡';
        btn.innerHTML = `<span class="scramble-action-icon">${icon}</span><span>${prompt.title}</span>`;
        btn.addEventListener('click', () => {
          const selection = window.getSelection();
          const selectedText = selection?.toString()?.trim();
          if (selectedText) {
            handleEnhanceText(prompt.id, selectedText);
          } else {
            showToast('Please select some text first.', 'warning');
          }
        });
        actionsContainer.appendChild(btn);
      });
    }
  } catch (error) {
    console.error('[Scramble] Error loading toolbar actions:', error);
  }
}

function showFloatingToolbar(rect) {
  const toolbar = createFloatingToolbar();

  // Position toolbar
  const top = rect.bottom + window.scrollY + 8;
  const left = Math.max(8, Math.min(rect.left + window.scrollX, window.innerWidth - 300));

  toolbar.style.top = `${top}px`;
  toolbar.style.left = `${left}px`;
  toolbar.classList.add('scramble-visible');

  // Update undo button state
  updateUndoButton();
}

function hideFloatingToolbar() {
  if (scrambleToolbar) {
    scrambleToolbar.classList.remove('scramble-visible');
    setTimeout(() => {
      scrambleToolbar?.remove();
      scrambleToolbar = null;
    }, 200);
  }
}

// ========== Text Selection Listener ==========

let selectionTimeout = null;
document.addEventListener('mouseup', (e) => {
  // Ignore clicks on our toolbar
  if (e.target.closest('#scramble-toolbar')) return;

  clearTimeout(selectionTimeout);
  selectionTimeout = setTimeout(() => {
    const selection = window.getSelection();
    const selectedText = selection?.toString()?.trim();

    if (selectedText && selectedText.length > 2) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      showFloatingToolbar(rect);
    } else {
      hideFloatingToolbar();
    }
  }, 300);
});

// Hide toolbar on click outside
document.addEventListener('mousedown', (e) => {
  if (scrambleToolbar && !e.target.closest('#scramble-toolbar')) {
    // Don't hide if user is making a selection
    const selection = window.getSelection();
    if (!selection?.toString()?.trim()) {
      hideFloatingToolbar();
    }
  }
});

// Hide on escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideFloatingToolbar();
  }
  // Ctrl+Z / Cmd+Z while toolbar is visible -> undo
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && undoStack.length > 0) {
    // Only intercept if we have scramble undo entries
    // Don't prevent default to allow normal undo when no scramble changes
  }
});

// ========== Text Enhancement ==========

async function handleEnhanceText(promptId, selectedText) {
  showToast('Enhancing your text...', 'loading');

  try {
    const response = await browserAPI.runtime.sendMessage({
      action: 'enhanceText',
      promptId: promptId,
      selectedText: selectedText,
    });

    if (response.success) {
      // Save undo state
      saveUndoState(selectedText);

      // Replace text
      replaceSelectedText(response.enhancedText);

      showToast('Text enhanced!', 'success');
    } else {
      throw new Error(response.error || 'Unknown error occurred');
    }
  } catch (error) {
    console.error('[Scramble] Error:', error);
    showToast(error.message || 'Failed to enhance text', 'error');
    throw error;
  }
}

// ========== Text Replacement ==========

function replaceSelectedText(enhancedText) {
  const activeElement = document.activeElement;

  // Handle input/textarea
  if (activeElement && (activeElement.tagName === 'TEXTAREA' || (activeElement.tagName === 'INPUT' && activeElement.type === 'text'))) {
    const start = activeElement.selectionStart;
    const end = activeElement.selectionEnd;
    const text = activeElement.value;
    activeElement.value = text.substring(0, start) + enhancedText + text.substring(end);

    // Set cursor after inserted text
    const newPos = start + enhancedText.length;
    activeElement.setSelectionRange(newPos, newPos);

    // Trigger events for reactive frameworks
    activeElement.dispatchEvent(new Event('input', { bubbles: true }));
    activeElement.dispatchEvent(new Event('change', { bubbles: true }));

    // React-specific
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement?.prototype || window.HTMLInputElement.prototype,
      'value'
    )?.set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(activeElement, activeElement.value);
      activeElement.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  // Handle contentEditable
  else if (activeElement && activeElement.isContentEditable) {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();

      // Handle multiline content
      const lines = enhancedText.split('\n');
      const fragment = document.createDocumentFragment();
      lines.forEach((line, i) => {
        fragment.appendChild(document.createTextNode(line));
        if (i < lines.length - 1) {
          fragment.appendChild(document.createElement('br'));
        }
      });
      range.insertNode(fragment);

      // Move cursor to end
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);

      // Trigger input event
      activeElement.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  // Handle regular selection on page
  else {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(enhancedText));
      selection.removeAllRanges();
    }
  }
}

// ========== Undo System ==========

function saveUndoState(originalText) {
  undoStack.push({
    text: originalText,
    timestamp: Date.now(),
    element: document.activeElement,
    selectionStart: document.activeElement?.selectionStart,
    selectionEnd: document.activeElement?.selectionEnd,
  });

  if (undoStack.length > MAX_UNDO) {
    undoStack.shift();
  }

  updateUndoButton();
}

function performUndo() {
  if (undoStack.length === 0) return;

  const lastState = undoStack.pop();

  // Try to replace the enhanced text with original
  if (lastState.element && (lastState.element.tagName === 'TEXTAREA' || lastState.element.tagName === 'INPUT')) {
    // For inputs, we'd need the full text state - simplified version
    showToast('Undo: previous text copied to clipboard', 'info');
    navigator.clipboard?.writeText(lastState.text);
  } else {
    showToast('Undo: previous text copied to clipboard', 'info');
    navigator.clipboard?.writeText(lastState.text);
  }

  updateUndoButton();
}

function updateUndoButton() {
  const btn = document.getElementById('scramble-undo-btn');
  if (btn) {
    btn.disabled = undoStack.length === 0;
  }
}

// ========== Toast Notifications ==========

function showToast(message, type = 'info') {
  // Remove existing toast
  const existing = document.getElementById('scramble-toast');
  if (existing) existing.remove();

  // Inject styles if needed
  if (!document.getElementById('scramble-styles')) {
    const style = document.createElement('style');
    style.id = 'scramble-styles';
    style.textContent = getScrambleStyles();
    document.head.appendChild(style);
  }

  const toast = document.createElement('div');
  toast.id = 'scramble-toast';
  toast.className = `scramble-toast scramble-toast-${type}`;

  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ',
    loading: '',
  };

  const iconHtml = type === 'loading'
    ? '<div class="scramble-spinner"></div>'
    : `<span class="scramble-toast-icon">${icons[type]}</span>`;

  toast.innerHTML = `
    ${iconHtml}
    <span class="scramble-toast-message">${message}</span>
  `;

  document.body.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.classList.add('scramble-toast-visible');
  });

  // Auto dismiss (except loading)
  if (type !== 'loading') {
    setTimeout(() => {
      toast.classList.remove('scramble-toast-visible');
      setTimeout(() => toast.remove(), 300);
    }, type === 'error' ? 5000 : 3000);
  }

  scrambleToast = toast;
}

// ========== Styles ==========

function getScrambleStyles() {
  return `
    /* Scramble Floating Toolbar */
    #scramble-toolbar {
      position: absolute;
      z-index: 2147483647;
      opacity: 0;
      transform: translateY(-4px);
      transition: opacity 0.2s ease, transform 0.2s ease;
      pointer-events: none;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 13px;
      line-height: 1.4;
      color: #1a1a2e;
    }
    #scramble-toolbar.scramble-visible {
      opacity: 1;
      transform: translateY(0);
      pointer-events: auto;
    }
    #scramble-toolbar-inner {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.08);
      width: 260px;
      overflow: hidden;
    }
    #scramble-toolbar-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 10px 12px;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: white;
      font-weight: 600;
      font-size: 13px;
    }
    #scramble-toolbar-header span {
      flex: 1;
    }
    #scramble-toolbar-close {
      background: none;
      border: none;
      color: white;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      padding: 0 2px;
      opacity: 0.8;
      transition: opacity 0.15s;
      width: auto;
      min-width: auto;
    }
    #scramble-toolbar-close:hover {
      opacity: 1;
    }
    #scramble-toolbar-actions {
      max-height: 280px;
      overflow-y: auto;
      padding: 6px;
    }
    #scramble-toolbar-actions::-webkit-scrollbar {
      width: 4px;
    }
    #scramble-toolbar-actions::-webkit-scrollbar-thumb {
      background: #cbd5e1;
      border-radius: 2px;
    }
    .scramble-action-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 8px 10px;
      border: none;
      background: transparent;
      color: #334155;
      cursor: pointer;
      border-radius: 8px;
      font-size: 13px;
      text-align: left;
      transition: all 0.15s;
      font-family: inherit;
      line-height: 1.3;
    }
    .scramble-action-btn:hover {
      background: #f1f5f9;
      color: #6366f1;
    }
    .scramble-action-btn:active {
      background: #e2e8f0;
    }
    .scramble-action-icon {
      font-size: 15px;
      width: 22px;
      text-align: center;
      flex-shrink: 0;
    }
    #scramble-toolbar-footer {
      padding: 6px 8px;
      border-top: 1px solid #f1f5f9;
      display: flex;
      justify-content: flex-end;
    }
    #scramble-undo-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 5px 10px;
      border: 1px solid #e2e8f0;
      background: #f8fafc;
      color: #64748b;
      cursor: pointer;
      border-radius: 6px;
      font-size: 12px;
      transition: all 0.15s;
      font-family: inherit;
    }
    #scramble-undo-btn:hover:not(:disabled) {
      background: #f1f5f9;
      color: #6366f1;
      border-color: #c7d2fe;
    }
    #scramble-undo-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    /* Toast Notifications */
    .scramble-toast {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 18px;
      border-radius: 10px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      transform: translateX(120%);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      max-width: 380px;
    }
    .scramble-toast-visible {
      transform: translateX(0);
    }
    .scramble-toast-success {
      background: #ecfdf5;
      color: #065f46;
      border: 1px solid #a7f3d0;
    }
    .scramble-toast-error {
      background: #fef2f2;
      color: #991b1b;
      border: 1px solid #fca5a5;
    }
    .scramble-toast-warning {
      background: #fffbeb;
      color: #92400e;
      border: 1px solid #fcd34d;
    }
    .scramble-toast-info {
      background: #eff6ff;
      color: #1e40af;
      border: 1px solid #93c5fd;
    }
    .scramble-toast-loading {
      background: #f5f3ff;
      color: #5b21b6;
      border: 1px solid #c4b5fd;
    }
    .scramble-toast-icon {
      font-size: 16px;
      flex-shrink: 0;
    }
    .scramble-toast-message {
      line-height: 1.4;
    }
    .scramble-spinner {
      width: 18px;
      height: 18px;
      border: 2px solid #c4b5fd;
      border-top: 2px solid #7c3aed;
      border-radius: 50%;
      animation: scramble-spin 0.7s linear infinite;
      flex-shrink: 0;
    }
    @keyframes scramble-spin {
      to { transform: rotate(360deg); }
    }

    /* Dark mode support */
    @media (prefers-color-scheme: dark) {
      #scramble-toolbar-inner {
        background: #1e293b;
        border-color: #334155;
      }
      .scramble-action-btn {
        color: #e2e8f0;
      }
      .scramble-action-btn:hover {
        background: #334155;
        color: #a5b4fc;
      }
      #scramble-toolbar-footer {
        border-color: #334155;
      }
      #scramble-undo-btn {
        background: #1e293b;
        border-color: #334155;
        color: #94a3b8;
      }
      #scramble-undo-btn:hover:not(:disabled) {
        background: #334155;
        color: #a5b4fc;
      }
      #scramble-toolbar-actions::-webkit-scrollbar-thumb {
        background: #475569;
      }
    }
  `;
}
