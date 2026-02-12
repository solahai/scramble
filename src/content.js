const browserAPI = (typeof browser !== 'undefined' ? browser : chrome);

// ========== State ==========
let scrambleToolbar = null;
let scrambleToast = null;
let undoStack = [];
let savedSelectedText = '';
let savedRange = null;
let savedActiveElement = null;
let savedSelectionStart = null;
let savedSelectionEnd = null;
const MAX_UNDO = 10;
let isProcessing = false;
let autoHideTimeout = null;

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

// ========== Editable Field Detection ==========

function isEditableContext(node) {
  if (!node) return false;
  // Check if the node or its ancestor is editable
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  if (!el) return false;
  if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type === 'text')) return true;
  if (el.isContentEditable) return true;
  // Walk up to find contentEditable parent
  let parent = el.parentElement;
  while (parent) {
    if (parent.isContentEditable) return true;
    if (parent.tagName === 'TEXTAREA' || (parent.tagName === 'INPUT')) return true;
    parent = parent.parentElement;
  }
  return false;
}

// ========== Floating Toolbar ==========

function createFloatingToolbar() {
  if (scrambleToolbar) {
    scrambleToolbar.remove();
  }

  const toolbar = document.createElement('div');
  toolbar.id = 'scramble-toolbar';
  toolbar.innerHTML = `
    <div id="scramble-toolbar-inner">
      <div id="scramble-toolbar-actions"></div>
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
          const selectedText = selection?.toString()?.trim() || savedSelectedText;
          if (selectedText) {
            handleEnhanceText(prompt.id, selectedText);
          } else {
            showToast('Please select some text first.', 'warning');
          }
        });
        actionsContainer.appendChild(btn);
      });

      // Add undo button at the end if there's undo history
      if (undoStack.length > 0) {
        const undoBtn = document.createElement('button');
        undoBtn.id = 'scramble-undo-btn';
        undoBtn.className = 'scramble-action-btn scramble-undo';
        undoBtn.innerHTML = `<span class="scramble-action-icon">↩</span><span>Undo</span>`;
        undoBtn.addEventListener('click', () => performUndo());
        actionsContainer.appendChild(undoBtn);
      }
    }
  } catch (error) {
    console.error('[Scramble] Error loading toolbar actions:', error);
  }
}

function showFloatingToolbar(rect) {
  // Save the full selection state before creating toolbar (clicking toolbar will deselect)
  const selection = window.getSelection();
  savedSelectedText = selection?.toString()?.trim() || '';
  
  // Save the range for contentEditable and regular page text
  if (selection && selection.rangeCount > 0) {
    savedRange = selection.getRangeAt(0).cloneRange();
  }
  
  // Save active element state for input/textarea
  const active = document.activeElement;
  if (active && (active.tagName === 'TEXTAREA' || (active.tagName === 'INPUT' && active.type === 'text'))) {
    savedActiveElement = active;
    savedSelectionStart = active.selectionStart;
    savedSelectionEnd = active.selectionEnd;
  } else if (active && active.isContentEditable) {
    savedActiveElement = active;
  } else {
    savedActiveElement = null;
    savedSelectionStart = null;
    savedSelectionEnd = null;
  }

  const toolbar = createFloatingToolbar();

  // Position toolbar near the selection
  const top = rect.bottom + window.scrollY + 6;
  const left = Math.max(8, Math.min(rect.left + window.scrollX, window.innerWidth - 220));

  toolbar.style.top = `${top}px`;
  toolbar.style.left = `${left}px`;
  toolbar.classList.add('scramble-visible');

  // Schedule auto-hide after 6 seconds of inactivity (unless processing)
  scheduleAutoHide();
}

function scheduleAutoHide() {
  clearTimeout(autoHideTimeout);
  if (isProcessing) return;
  autoHideTimeout = setTimeout(() => {
    // Only auto-hide if no text is currently selected
    const selection = window.getSelection();
    const selectedText = selection?.toString()?.trim();
    if (!selectedText) {
      hideFloatingToolbar();
    } else {
      // Text still selected, reschedule
      scheduleAutoHide();
    }
  }, 5000);
}

function hideFloatingToolbar() {
  clearTimeout(autoHideTimeout);
  if (scrambleToolbar) {
    scrambleToolbar.classList.remove('scramble-visible');
    setTimeout(() => {
      scrambleToolbar?.remove();
      scrambleToolbar = null;
    }, 150);
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
      // Only auto-show toolbar when selecting inside editable areas
      const anchorNode = selection.anchorNode;
      if (isEditableContext(anchorNode)) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        showFloatingToolbar(rect);
      } else {
        // For non-editable content, hide toolbar (use context menu or keyboard shortcut instead)
        hideFloatingToolbar();
      }
    } else {
      hideFloatingToolbar();
    }
  }, 400);
});

// Hide toolbar on click outside
document.addEventListener('mousedown', (e) => {
  if (scrambleToolbar && !e.target.closest('#scramble-toolbar')) {
    hideFloatingToolbar();
  }
});

// Hide on escape or when selection changes
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideFloatingToolbar();
  }
});

// Hide when window loses focus
window.addEventListener('blur', () => {
  // Small delay to allow toolbar clicks to register
  setTimeout(() => {
    if (!document.hasFocus()) {
      hideFloatingToolbar();
    }
  }, 200);
});

// ========== Text Enhancement ==========

async function handleEnhanceText(promptId, selectedText) {
  isProcessing = true;
  clearTimeout(autoHideTimeout);
  showToast('Enhancing...', 'loading');

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

      showToast('Done!', 'success');
      hideFloatingToolbar();
    } else {
      throw new Error(response.error || 'Unknown error occurred');
    }
  } catch (error) {
    console.error('[Scramble] Error:', error);
    showToast(error.message || 'Failed to enhance text', 'error');
    throw error;
  } finally {
    isProcessing = false;
  }
}

// ========== Text Replacement ==========

function replaceSelectedText(enhancedText) {
  // Use saved state since clicking toolbar deselects text
  const activeElement = savedActiveElement || document.activeElement;

  // Handle input/textarea - preserve line breaks in the value
  if (activeElement && (activeElement.tagName === 'TEXTAREA' || (activeElement.tagName === 'INPUT' && activeElement.type === 'text'))) {
    const start = savedSelectionStart ?? activeElement.selectionStart;
    const end = savedSelectionEnd ?? activeElement.selectionEnd;
    const text = activeElement.value;
    
    // Preserve the original paragraph structure: detect line break pattern
    const originalSelection = text.substring(start, end);
    const preservedText = preserveLineBreaks(originalSelection, enhancedText);
    
    activeElement.focus();

    // Use execCommand for better undo support, fallback to direct assignment
    activeElement.setSelectionRange(start, end);
    if (!document.execCommand('insertText', false, preservedText)) {
      activeElement.value = text.substring(0, start) + preservedText + text.substring(end);
    }

    // Set cursor after inserted text
    const newPos = start + preservedText.length;
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
  // Handle contentEditable - preserve existing DOM structure (paragraphs, divs, etc.)
  else if (activeElement && activeElement.isContentEditable && savedRange) {
    activeElement.focus();
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(savedRange);
    
    const range = selection.getRangeAt(0);
    
    // Capture the HTML structure of the selected content to preserve paragraph formatting
    const selectedFragment = range.cloneContents();
    const tempDiv = document.createElement('div');
    tempDiv.appendChild(selectedFragment);
    const originalHTML = tempDiv.innerHTML;
    
    // Check if the selection spans block elements (p, div, li, etc.)
    const hasBlockElements = /<(p|div|li|h[1-6]|blockquote)\b/i.test(originalHTML);
    
    range.deleteContents();
    
    if (hasBlockElements) {
      // The original had paragraph/block structure - preserve it
      // Split the enhanced text by newlines and map to the same block structure
      const enhancedLines = enhancedText.split(/\n+/).filter(l => l.trim());
      
      // Detect what block tag was used (p, div, etc.)
      const blockMatch = originalHTML.match(/<(p|div|li|h[1-6]|blockquote)\b/i);
      const blockTag = blockMatch ? blockMatch[1].toLowerCase() : 'p';
      
      // Get the attributes from the first block element for style consistency
      const attrMatch = originalHTML.match(new RegExp(`<${blockTag}([^>]*)>`, 'i'));
      const attrs = attrMatch ? attrMatch[1] : '';
      
      const fragment = document.createDocumentFragment();
      
      // If single paragraph, just insert text content
      if (enhancedLines.length <= 1) {
        const textNode = document.createTextNode(enhancedText.trim());
        fragment.appendChild(textNode);
      } else {
        // Multiple paragraphs - recreate blocks
        enhancedLines.forEach((line, i) => {
          if (i === 0) {
            // First line: insert as text node (goes into the existing first block)
            fragment.appendChild(document.createTextNode(line.trim()));
          } else {
            // Subsequent lines: create new block elements
            const block = document.createElement(blockTag);
            if (attrs) {
              // Copy attributes from original
              const tempEl = document.createElement('div');
              tempEl.innerHTML = `<${blockTag}${attrs}></${blockTag}>`;
              const src = tempEl.firstChild;
              for (const attr of src.attributes) {
                block.setAttribute(attr.name, attr.value);
              }
            }
            block.textContent = line.trim();
            fragment.appendChild(block);
          }
        });
      }
      
      range.insertNode(fragment);
    } else {
      // No block structure - simple text replacement, preserve <br> pattern
      const hasBRs = /<br\s*\/?>/i.test(originalHTML);
      
      if (hasBRs && enhancedText.includes('\n')) {
        const lines = enhancedText.split('\n');
        const fragment = document.createDocumentFragment();
        lines.forEach((line, i) => {
          fragment.appendChild(document.createTextNode(line));
          if (i < lines.length - 1) {
            fragment.appendChild(document.createElement('br'));
          }
        });
        range.insertNode(fragment);
      } else {
        // Plain text, no line breaks to worry about
        range.insertNode(document.createTextNode(enhancedText));
      }
    }

    // Move cursor to end
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);

    // Trigger input event
    activeElement.dispatchEvent(new Event('input', { bubbles: true }));
  }
  // Handle regular selection on page (non-editable text)
  else if (savedRange) {
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(savedRange);
    
    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(enhancedText));
    selection.removeAllRanges();
  }
  // Fallback: copy to clipboard
  else {
    navigator.clipboard?.writeText(enhancedText);
    showToast('Enhanced text copied to clipboard.', 'info');
  }
}

// Preserve the line-break/paragraph structure of the original text
function preserveLineBreaks(original, enhanced) {
  // Count double-newlines (paragraph breaks) vs single newlines in original
  const origParaBreaks = (original.match(/\n\s*\n/g) || []).length;
  const origSingleBreaks = (original.match(/\n/g) || []).length;
  const enhancedParaBreaks = (enhanced.match(/\n\s*\n/g) || []).length;
  
  // If the original had paragraph breaks but the enhanced doesn't, 
  // the AI likely flattened the paragraphs - try to restore structure
  if (origParaBreaks > 0 && enhancedParaBreaks === 0 && enhanced.includes('\n')) {
    // The enhanced text has single newlines where there should be double newlines
    // This happens when AI strips paragraph spacing
    return enhanced;
  }
  
  // If original had no newlines but enhanced added them, or vice versa,
  // respect the enhanced text as-is (the AI intentionally changed structure)
  return enhanced;
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
  // Undo button is now part of the action list, no separate update needed
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
    }, type === 'error' ? 4000 : 2000);
  }

  scrambleToast = toast;
}

// ========== Styles ==========

function getScrambleStyles() {
  return `
    /* Scramble Floating Toolbar — Minimal */
    #scramble-toolbar {
      position: absolute;
      z-index: 2147483647;
      opacity: 0;
      transform: translateY(-2px) scale(0.98);
      transition: opacity 0.15s ease, transform 0.15s ease;
      pointer-events: none;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 12px;
      line-height: 1.3;
      color: #334155;
    }
    #scramble-toolbar.scramble-visible {
      opacity: 1;
      transform: translateY(0) scale(1);
      pointer-events: auto;
    }
    #scramble-toolbar-inner {
      background: #ffffff;
      border: 1px solid rgba(0,0,0,0.08);
      border-radius: 10px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.1), 0 0 1px rgba(0,0,0,0.1);
      width: 200px;
      overflow: hidden;
    }
    #scramble-toolbar-actions {
      max-height: 260px;
      overflow-y: auto;
      padding: 4px;
    }
    #scramble-toolbar-actions::-webkit-scrollbar {
      width: 3px;
    }
    #scramble-toolbar-actions::-webkit-scrollbar-thumb {
      background: #d1d5db;
      border-radius: 3px;
    }
    .scramble-action-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 6px 8px;
      border: none;
      background: transparent;
      color: #475569;
      cursor: pointer;
      border-radius: 6px;
      font-size: 12px;
      text-align: left;
      transition: background 0.1s, color 0.1s;
      font-family: inherit;
      line-height: 1.3;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .scramble-action-btn:hover {
      background: #f1f5f9;
      color: #6366f1;
    }
    .scramble-action-btn:active {
      background: #e2e8f0;
    }
    .scramble-action-btn.scramble-undo {
      border-top: 1px solid #f1f5f9;
      margin-top: 2px;
      padding-top: 7px;
      color: #94a3b8;
      font-size: 11px;
    }
    .scramble-action-btn.scramble-undo:hover {
      color: #6366f1;
    }
    .scramble-action-icon {
      font-size: 13px;
      width: 18px;
      text-align: center;
      flex-shrink: 0;
    }

    /* Toast Notifications — Compact */
    .scramble-toast {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 14px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      font-weight: 500;
      box-shadow: 0 2px 12px rgba(0,0,0,0.12);
      transform: translateY(20px);
      opacity: 0;
      transition: transform 0.2s ease, opacity 0.2s ease;
      max-width: 280px;
    }
    .scramble-toast-visible {
      transform: translateY(0);
      opacity: 1;
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
      background: #fafafa;
      color: #6366f1;
      border: 1px solid #e2e8f0;
    }
    .scramble-toast-icon {
      font-size: 13px;
      flex-shrink: 0;
    }
    .scramble-toast-message {
      line-height: 1.3;
    }
    .scramble-spinner {
      width: 14px;
      height: 14px;
      border: 2px solid #e2e8f0;
      border-top: 2px solid #6366f1;
      border-radius: 50%;
      animation: scramble-spin 0.6s linear infinite;
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
        box-shadow: 0 2px 12px rgba(0,0,0,0.3);
      }
      .scramble-action-btn {
        color: #cbd5e1;
      }
      .scramble-action-btn:hover {
        background: #334155;
        color: #a5b4fc;
      }
      .scramble-action-btn.scramble-undo {
        border-color: #334155;
        color: #64748b;
      }
      #scramble-toolbar-actions::-webkit-scrollbar-thumb {
        background: #475569;
      }
      .scramble-toast-loading {
        background: #1e293b;
        color: #a5b4fc;
        border-color: #334155;
      }
    }
  `;
}
