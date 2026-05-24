const browserAPI = (typeof browser !== 'undefined' ? browser : chrome);

// Prevent duplicate listeners when the content script is injected twice.
const SCRAMBLE_ALREADY_LOADED = !!globalThis.__scrambleContentLoaded;
if (!SCRAMBLE_ALREADY_LOADED) {
  globalThis.__scrambleContentLoaded = true;
}

// ========== State ==========
let scrambleToolbar = null;
let undoStack = [];
let savedSelectedText = '';
let savedRange = null;
let savedActiveElement = null;
let savedSelectionStart = null;
let savedSelectionEnd = null;
let selectionSnapshot = null;
const MAX_UNDO = 10;
let isProcessing = false;
let autoHideTimeout = null;
let currentRequestId = null;
let toolbarPinned = false;
let previewModalResolve = null;

const TEXT_INPUT_TYPES = ['text', 'search', 'email', 'url', 'tel', 'password', ''];

const PROMPT_ICONS = {
  fix_grammar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>',
  improve_writing: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
  make_professional: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>',
  simplify: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="21" y1="10" x2="7" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="21" y1="18" x2="7" y2="18"/></svg>',
  summarize: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>',
  bullet_points: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>',
  make_friendly: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
  make_concise: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>',
  translate_english: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
};

const DEFAULT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';

function isExtensionInvalidated(error) {
  const msg = error?.message || String(error || '');
  return /extension context invalidated|receiving end does not exist|could not establish connection/i.test(msg);
}

async function sendRuntimeMessage(message) {
  try {
    return await browserAPI.runtime.sendMessage(message);
  } catch (error) {
    if (isExtensionInvalidated(error)) {
      throw new Error('Scramble was reloaded. Refresh this page and try again.');
    }
    throw error;
  }
}

// ========== Selection Helpers ==========

function getPageSelectedText() {
  const active = document.activeElement;
  if (isTextInputElement(active)) {
    const start = active.selectionStart;
    const end = active.selectionEnd;
    if (start != null && end != null && start !== end) {
      return active.value.substring(start, end).trim();
    }
  }
  return window.getSelection()?.toString()?.trim() || '';
}

function captureSelectionFromPage() {
  const text = getPageSelectedText();
  if (text) captureSelectionState(text);
}

// ========== Message Listener ==========
function handleRuntimeMessage(request, sender, sendResponse) {
  if (request.action === 'ping') {
    sendResponse({ success: true });
    return;
  }

  if (request.action === 'showToast') {
    showToast(request.message, request.type || 'info');
    sendResponse({ success: true });
    return;
  }

  if (request.action === 'queueStatus') {
    showToast(`Queued… position ${request.position} in line`, 'info', { persist: false, duration: 2000 });
    sendResponse({ success: true });
    return;
  }

  if (request.action === 'enhanceText') {
    const text = request.selectedText?.trim();
    if (!text) {
      showToast('Please select some text first.', 'warning');
      sendResponse({ success: false, error: 'No text selected' });
      return;
    }
    if (!hasValidReplaceTarget() || savedSelectedText !== text) {
      captureSelectionState(text);
    }
    handleEnhanceText(request.promptId, text)
      .then(() => sendResponse({ success: true }))
      .catch(error => {
        dismissToast();
        showToast(friendlyError(error.message), 'error');
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === 'triggerFromShortcut') {
    const selectedText = getPageSelectedText();
    if (selectedText) {
      if (!hasValidReplaceTarget() || savedSelectedText !== selectedText) {
        captureSelectionState(selectedText);
      }
      handleEnhanceText(request.promptId, selectedText)
        .then(() => sendResponse({ success: true }))
        .catch(error => {
          dismissToast();
          showToast(friendlyError(error.message), 'error');
          sendResponse({ success: false, error: error.message });
        });
    } else {
      showToast('Please select some text first.', 'warning');
      sendResponse({ success: false, error: 'No text selected' });
    }
    return true;
  }

  if (request.action === 'showToolbar') {
    const selectedText = getPageSelectedText();
    const selection = window.getSelection();
    if (selectedText) {
      if (!hasValidReplaceTarget() || savedSelectedText !== selectedText) {
        captureSelectionState(selectedText);
      }
      const rect = selection?.rangeCount > 0
        ? selection.getRangeAt(0).getBoundingClientRect()
        : { bottom: 100, left: 100, right: 400, top: 80, width: 300, height: 20 };
      showFloatingToolbar(rect, true);
    } else {
      showToast('Select some text to use Scramble.', 'info');
    }
    sendResponse({ success: true });
    return;
  }
}

// ========== Selection Capture ==========

function isTextInputElement(el) {
  return el && (
    el.tagName === 'TEXTAREA' ||
    (el.tagName === 'INPUT' && TEXT_INPUT_TYPES.includes(el.type))
  );
}

function hasValidReplaceTarget() {
  if (!savedSelectedText) return false;
  if (selectionSnapshot?.type === 'input' && savedActiveElement && document.body.contains(savedActiveElement)) {
    return savedSelectionStart != null && savedSelectionEnd != null;
  }
  if (selectionSnapshot?.type === 'contenteditable' && savedRange) return true;
  if (selectionSnapshot?.type === 'range' && savedRange) return true;
  return false;
}

function findInputFieldForText(text) {
  if (!text) return null;

  const active = document.activeElement;
  if (isTextInputElement(active)) {
    const idx = active.value.indexOf(text);
    if (idx >= 0) {
      return { element: active, start: idx, end: idx + text.length };
    }
  }

  for (const el of document.querySelectorAll('textarea, input')) {
    if (!isTextInputElement(el)) continue;
    const idx = el.value.indexOf(text);
    if (idx >= 0) {
      return { element: el, start: idx, end: idx + text.length };
    }
  }
  return null;
}

function captureSelectionState(fallbackText) {
  const selection = window.getSelection();
  const active = document.activeElement;

  savedSelectedText = (fallbackText || selection?.toString() || '').trim();

  savedRange = null;
  savedActiveElement = null;
  savedSelectionStart = null;
  savedSelectionEnd = null;
  selectionSnapshot = { type: 'none', originalText: savedSelectedText };

  const isTextInput = isTextInputElement(active);

  if (isTextInput) {
    savedActiveElement = active;
    let start = active.selectionStart;
    let end = active.selectionEnd;

    if ((start === end || start == null) && savedSelectedText) {
      const idx = active.value.indexOf(savedSelectedText);
      if (idx >= 0) {
        start = idx;
        end = idx + savedSelectedText.length;
      }
    }

    savedSelectionStart = start;
    savedSelectionEnd = end;
    selectionSnapshot = {
      type: 'input',
      element: active,
      start,
      end,
      originalText: savedSelectedText,
      fullValue: active.value,
    };
    return;
  }

  if (active && active.isContentEditable) {
    savedActiveElement = active;
    if (selection && selection.rangeCount > 0 && selection.toString().trim()) {
      savedRange = selection.getRangeAt(0).cloneRange();
    } else if (savedSelectedText) {
      savedRange = findRangeForText(active, savedSelectedText);
    }
    selectionSnapshot = {
      type: 'contenteditable',
      element: active,
      range: savedRange ? savedRange.cloneRange() : null,
      originalText: savedSelectedText,
    };
    return;
  }

  if (selection && selection.rangeCount > 0 && savedSelectedText) {
    try {
      savedRange = selection.getRangeAt(0).cloneRange();
      selectionSnapshot = {
        type: 'range',
        range: savedRange.cloneRange(),
        originalText: savedSelectedText,
      };
    } catch (e) {
      selectionSnapshot = { type: 'clipboard', originalText: savedSelectedText };
    }
    return;
  }

  if (savedSelectedText) {
    const inputMatch = findInputFieldForText(savedSelectedText);
    if (inputMatch) {
      savedActiveElement = inputMatch.element;
      savedSelectionStart = inputMatch.start;
      savedSelectionEnd = inputMatch.end;
      selectionSnapshot = {
        type: 'input',
        element: inputMatch.element,
        start: inputMatch.start,
        end: inputMatch.end,
        originalText: savedSelectedText,
        fullValue: inputMatch.element.value,
      };
      return;
    }

    const bodyRange = findRangeForText(document.body, savedSelectedText);
    if (bodyRange) {
      savedRange = bodyRange;
      selectionSnapshot = {
        type: 'range',
        range: bodyRange.cloneRange(),
        originalText: savedSelectedText,
      };
      return;
    }

    selectionSnapshot = {
      type: 'clipboard',
      originalText: savedSelectedText,
      editable: isEditableContext(selection?.anchorNode),
    };
  }
}

function findRangeForText(root, text) {
  if (!text) return null;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const idx = node.textContent.indexOf(text);
    if (idx >= 0) {
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + text.length);
      return range;
    }
  }

  // Selection may span multiple text nodes — walk and match across boundaries.
  const textNodes = [];
  const nodeWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while ((node = nodeWalker.nextNode())) {
    if (node.textContent) textNodes.push(node);
  }

  const combined = textNodes.map(n => n.textContent).join('');
  const combinedIndex = combined.indexOf(text);
  if (combinedIndex < 0) return null;

  let offset = 0;
  let startNode = null;
  let startOffset = 0;
  let endNode = null;
  let endOffset = 0;
  const endIndex = combinedIndex + text.length;

  for (const textNode of textNodes) {
    const nodeStart = offset;
    const nodeEnd = offset + textNode.textContent.length;

    if (!startNode && combinedIndex >= nodeStart && combinedIndex < nodeEnd) {
      startNode = textNode;
      startOffset = combinedIndex - nodeStart;
    }
    if (endIndex > nodeStart && endIndex <= nodeEnd) {
      endNode = textNode;
      endOffset = endIndex - nodeStart;
      break;
    }
    offset = nodeEnd;
  }

  if (!startNode || !endNode) return null;

  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

function restoreSelectionSnapshot(snapshot) {
  if (!snapshot) return;
  savedActiveElement = snapshot.element || null;
  savedSelectionStart = snapshot.start ?? null;
  savedSelectionEnd = snapshot.end ?? null;
  savedSelectedText = snapshot.originalText || '';
  savedRange = snapshot.range ? snapshot.range.cloneRange() : null;
  selectionSnapshot = { ...snapshot, range: savedRange };
}

// ========== Editable Field Detection ==========

function isEditableContext(node) {
  if (!node) return false;
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  if (!el) return false;
  if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && TEXT_INPUT_TYPES.includes(el.type))) return true;
  if (el.isContentEditable) return true;
  let parent = el.parentElement;
  while (parent) {
    if (parent.isContentEditable) return true;
    if (parent.tagName === 'TEXTAREA' || parent.tagName === 'INPUT') return true;
    parent = parent.parentElement;
  }
  return false;
}

// ========== Floating Toolbar ==========

function ensureStyles() {
  if (!document.getElementById('scramble-styles')) {
    const style = document.createElement('style');
    style.id = 'scramble-styles';
    style.textContent = getScrambleStyles();
    document.head.appendChild(style);
  }
}

function createFloatingToolbar(readOnlyHint = false) {
  if (scrambleToolbar) scrambleToolbar.remove();

  ensureStyles();
  const toolbar = document.createElement('div');
  toolbar.id = 'scramble-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Scramble writing actions');
  toolbar.innerHTML = `
    <div id="scramble-toolbar-inner">
      ${readOnlyHint ? '<div id="scramble-toolbar-hint" role="note">Read-only area — preview before applying</div>' : ''}
      <div id="scramble-toolbar-actions"></div>
    </div>
  `;

  document.body.appendChild(toolbar);
  scrambleToolbar = toolbar;
  loadToolbarActions();
  return toolbar;
}

async function loadToolbarActions() {
  try {
    const response = await sendRuntimeMessage({ action: 'getPrompts' });
    if (!response?.success) return;

    const actionsContainer = document.getElementById('scramble-toolbar-actions');
    if (!actionsContainer) return;
    actionsContainer.innerHTML = '';

    response.prompts.forEach(prompt => {
      const btn = document.createElement('button');
      btn.className = 'scramble-action-btn';
      btn.type = 'button';
      btn.dataset.promptId = prompt.id;
      btn.setAttribute('aria-label', prompt.title);
      btn.title = prompt.title;
      const icon = PROMPT_ICONS[prompt.id] || DEFAULT_ICON;
      btn.innerHTML = `<span class="scramble-action-icon">${icon}</span><span class="scramble-action-label">${escapeHtml(prompt.title)}</span>`;
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => {
        const text = savedSelectedText || window.getSelection()?.toString()?.trim();
        if (text) {
          if (!selectionSnapshot) captureSelectionState(text);
          handleEnhanceText(prompt.id, text);
        } else {
          showToast('Please select some text first.', 'warning');
        }
      });
      actionsContainer.appendChild(btn);
    });

    if (undoStack.length > 0) {
      const undoBtn = document.createElement('button');
      undoBtn.id = 'scramble-undo-btn';
      undoBtn.type = 'button';
      undoBtn.className = 'scramble-action-btn scramble-undo';
      undoBtn.setAttribute('aria-label', 'Undo last change');
      undoBtn.innerHTML = `<span class="scramble-action-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></span><span class="scramble-action-label">Undo</span>`;
      undoBtn.addEventListener('click', () => performUndo());
      actionsContainer.appendChild(undoBtn);
    }
  } catch (error) {
    if (isExtensionInvalidated(error)) {
      showToast('Scramble was reloaded. Refresh this page and try again.', 'warning', { duration: 5000 });
      return;
    }
    console.error('[Scramble] Error loading toolbar actions:', error);
  }
}

function showFloatingToolbar(rect, forceShow = false) {
  const text = getPageSelectedText();
  if (text) {
    if (!hasValidReplaceTarget() || savedSelectedText !== text) {
      captureSelectionState(text);
    }
  } else if (!hasValidReplaceTarget()) {
    return;
  }

  const selection = window.getSelection();
  const editable = isEditableContext(selection?.anchorNode) || selectionSnapshot?.type === 'input';
  if (!editable && !forceShow) {
    hideFloatingToolbar();
    return;
  }

  const toolbar = createFloatingToolbar(!editable);
  const toolbarWidth = 300;
  const top = rect.bottom + window.scrollY + 6;
  const left = Math.max(8, Math.min(rect.left + window.scrollX, window.innerWidth - toolbarWidth - 8));

  toolbar.style.top = `${top}px`;
  toolbar.style.left = `${left}px`;
  toolbar.classList.add('scramble-visible');
  scheduleAutoHide();
}

function scheduleAutoHide() {
  clearTimeout(autoHideTimeout);
  if (isProcessing || toolbarPinned) return;
  autoHideTimeout = setTimeout(() => {
    const selection = window.getSelection();
    if (!selection?.toString()?.trim()) {
      hideFloatingToolbar();
    } else {
      scheduleAutoHide();
    }
  }, 15000);
}

function hideFloatingToolbar(force = false) {
  if (isProcessing && !force) return;
  clearTimeout(autoHideTimeout);
  if (!isProcessing) toolbarPinned = false;
  if (scrambleToolbar) {
    scrambleToolbar.classList.remove('scramble-visible');
    setTimeout(() => {
      scrambleToolbar?.remove();
      scrambleToolbar = null;
    }, 150);
  }
}

let selectionTimeout = null;

function bindPageEventListeners() {
  document.addEventListener('contextmenu', () => {
    captureSelectionFromPage();
  }, true);

  document.addEventListener('mouseup', (e) => {
    if (e.target.closest('#scramble-toolbar, #scramble-preview-overlay')) return;

    captureSelectionFromPage();

    clearTimeout(selectionTimeout);
    selectionTimeout = setTimeout(() => {
      const selectedText = getPageSelectedText();

      if (selectedText && selectedText.length > 2) {
        const selection = window.getSelection();
        const anchorNode = selection?.anchorNode;
        const rect = selection?.rangeCount > 0
          ? selection.getRangeAt(0).getBoundingClientRect()
          : { bottom: 100, left: 100, right: 400, top: 80, width: 300, height: 20 };
        if (isEditableContext(anchorNode) || isTextInputElement(document.activeElement)) {
          showFloatingToolbar(rect);
        } else {
          showFloatingToolbar(rect, true);
        }
      } else if (!isProcessing) {
        hideFloatingToolbar();
      }
    }, 400);
  });

  document.addEventListener('mousedown', (e) => {
    if (e.target.closest('#scramble-toolbar, #scramble-preview-overlay')) {
      toolbarPinned = true;
      return;
    }
    if (scrambleToolbar && !isProcessing) {
      hideFloatingToolbar();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (document.getElementById('scramble-preview-overlay')) {
        closePreviewModal(false);
      } else if (isProcessing && currentRequestId) {
        browserAPI.runtime.sendMessage({ action: 'cancelEnhancement', requestId: currentRequestId }).catch(() => {});
        isProcessing = false;
        currentRequestId = null;
        dismissToast();
        showToast('Cancelled.', 'info');
      } else {
        hideFloatingToolbar();
      }
    }
  });

  window.addEventListener('blur', () => {
    setTimeout(() => {
      if (!document.hasFocus() && !isProcessing && !document.getElementById('scramble-preview-overlay')) {
        hideFloatingToolbar();
      }
    }, 200);
  });
}
// ========== Text Enhancement ==========

async function handleEnhanceText(promptId, selectedText) {
  if (!selectedText?.trim()) {
    showToast('Please select some text first.', 'warning');
    return;
  }

  if (!selectionSnapshot || !hasValidReplaceTarget()) {
    captureSelectionState(selectedText);
  }

  const snapshotForRestore = {
    type: selectionSnapshot?.type,
    element: selectionSnapshot?.element || savedActiveElement,
    start: savedSelectionStart,
    end: savedSelectionEnd,
    range: savedRange?.cloneRange?.() || selectionSnapshot?.range?.cloneRange?.() || null,
    originalText: selectedText,
    fullValue: selectionSnapshot?.fullValue,
  };

  isProcessing = true;
  toolbarPinned = true;
  clearTimeout(autoHideTimeout);
  currentRequestId = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  hideFloatingToolbar(true);

  showLoadingToast('Enhancing…', () => {
    browserAPI.runtime.sendMessage({ action: 'cancelEnhancement', requestId: currentRequestId }).catch(() => {});
    isProcessing = false;
    currentRequestId = null;
    dismissToast();
    showToast('Cancelled.', 'info');
  });

  try {
    const configResp = await sendRuntimeMessage({ action: 'getConfig' });
    const showPreview = configResp?.success ? configResp.config.showPreview !== false : true;

    const response = await sendRuntimeMessage({
      action: 'enhanceText',
      promptId,
      selectedText,
      requestId: currentRequestId,
    });

    dismissToast();

    if (!response?.success) {
      throw new Error(response?.error || 'Unknown error occurred');
    }

    if (showPreview) {
      const accepted = await showPreviewModal(selectedText, response.enhancedText);
      if (!accepted) {
        showToast('Changes discarded.', 'info');
        return;
      }
    }

    restoreSelectionSnapshot(snapshotForRestore);

    const applySnapshot = buildApplySnapshot(selectedText, response.enhancedText);
    const applied = replaceSelectedText(response.enhancedText);
    if (applied) {
      applySnapshot.end = applySnapshot.start + response.enhancedText.length;
      saveUndoState(applySnapshot);
      showToast('Done!', 'success');
      hideFloatingToolbar();
    }
  } catch (error) {
    dismissToast();
    if (error.message !== 'Cancelled') {
      showToast(friendlyError(error.message), 'error');
    }
    throw error;
  } finally {
    isProcessing = false;
    currentRequestId = null;
    toolbarPinned = false;
  }
}

function buildApplySnapshot(originalText, enhancedText) {
  return {
    originalText,
    enhancedText,
    element: savedActiveElement,
    start: savedSelectionStart,
    end: savedSelectionEnd,
    range: savedRange?.cloneRange?.() || null,
    selectedText: savedSelectedText,
    type: selectionSnapshot?.type || 'none',
    fullValue: selectionSnapshot?.fullValue,
  };
}

// ========== Preview Modal ==========

function showPreviewModal(original, enhanced) {
  ensureStyles();
  hideFloatingToolbar(true);
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = 'scramble-preview-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Review AI changes');
    overlay.innerHTML = `
      <div class="scramble-preview-modal">
        <div class="scramble-preview-header">
          <h3>Review changes</h3>
          <p>Compare the original and enhanced text before applying.</p>
        </div>
        <div class="scramble-preview-panels">
          <div class="scramble-preview-panel">
            <span class="scramble-preview-label">Original</span>
            <div class="scramble-preview-text" id="scramble-preview-original"></div>
          </div>
          <div class="scramble-preview-panel scramble-preview-panel-enhanced">
            <span class="scramble-preview-label">Enhanced</span>
            <div class="scramble-preview-text" id="scramble-preview-enhanced"></div>
          </div>
        </div>
        <div class="scramble-preview-actions">
          <button type="button" class="scramble-preview-btn scramble-preview-reject" id="scramble-preview-reject">Reject</button>
          <button type="button" class="scramble-preview-btn scramble-preview-accept" id="scramble-preview-accept">Apply changes</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#scramble-preview-original').textContent = original;
    overlay.querySelector('#scramble-preview-enhanced').textContent = enhanced;

    const cleanup = (accepted) => {
      previewModalResolve = null;
      overlay.remove();
      resolve(accepted);
    };

    previewModalResolve = resolve;

    overlay.querySelector('#scramble-preview-accept').addEventListener('click', () => cleanup(true));
    overlay.querySelector('#scramble-preview-reject').addEventListener('click', () => cleanup(false));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup(false);
    });
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') cleanup(true);
    });
    overlay.querySelector('.scramble-preview-accept')?.focus();
  });
}

function closePreviewModal(accepted = false) {
  const overlay = document.getElementById('scramble-preview-overlay');
  if (!overlay) return;
  overlay.remove();
  if (previewModalResolve) {
    const resolve = previewModalResolve;
    previewModalResolve = null;
    resolve(accepted);
  }
}

// ========== Text Replacement ==========

function setNativeInputValue(el, value) {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;

  try {
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertReplacementText',
      data: value,
    }));
  } catch {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function replaceSelectedText(enhancedText) {
  const activeElement = savedActiveElement || document.activeElement;
  const canReplaceInPlace = selectionSnapshot?.type !== 'clipboard' || selectionSnapshot?.editable;

  if (isTextInputElement(activeElement)) {
    const start = savedSelectionStart ?? activeElement.selectionStart;
    const end = savedSelectionEnd ?? activeElement.selectionEnd;
    if (start == null || end == null || start === end) {
      navigator.clipboard?.writeText(enhancedText);
      showToast('Could not locate selection — enhanced text copied to clipboard.', 'info', { duration: 4000 });
      return false;
    }

    const text = activeElement.value;
    const originalSelection = text.substring(start, end);
    const preservedText = preserveLineBreaks(originalSelection, enhancedText);

    activeElement.focus();
    activeElement.setSelectionRange(start, end);
    if (!document.execCommand('insertText', false, preservedText)) {
      const newValue = text.substring(0, start) + preservedText + text.substring(end);
      setNativeInputValue(activeElement, newValue);
    } else {
      setNativeInputValue(activeElement, activeElement.value);
    }

    const newPos = start + preservedText.length;
    activeElement.setSelectionRange(newPos, newPos);
    return true;
  }

  const editableElement = (savedActiveElement?.isContentEditable && savedActiveElement)
    || (activeElement?.isContentEditable ? activeElement : null);

  if (editableElement && savedRange) {
    editableElement.focus();
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(savedRange);

    const range = selection.getRangeAt(0);
    const selectedFragment = range.cloneContents();
    const tempDiv = document.createElement('div');
    tempDiv.appendChild(selectedFragment);
    const originalHTML = tempDiv.innerHTML;
    const hasBlockElements = /<(p|div|li|h[1-6]|blockquote)\b/i.test(originalHTML);

    range.deleteContents();

    if (hasBlockElements) {
      const enhancedLines = enhancedText.split(/\n+/).filter(l => l.trim());
      const blockMatch = originalHTML.match(/<(p|div|li|h[1-6]|blockquote)\b/i);
      const blockTag = blockMatch ? blockMatch[1].toLowerCase() : 'p';
      const attrMatch = originalHTML.match(new RegExp(`<${blockTag}([^>]*)>`, 'i'));
      const attrs = attrMatch ? attrMatch[1] : '';
      const fragment = document.createDocumentFragment();

      if (enhancedLines.length <= 1) {
        fragment.appendChild(document.createTextNode(enhancedText.trim()));
      } else {
        enhancedLines.forEach((line, i) => {
          if (i === 0) {
            fragment.appendChild(document.createTextNode(line.trim()));
          } else {
            const block = document.createElement(blockTag);
            if (attrs) {
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
      const hasBRs = /<br\s*\/?>/i.test(originalHTML);
      if (hasBRs && enhancedText.includes('\n')) {
        const lines = enhancedText.split('\n');
        const fragment = document.createDocumentFragment();
        lines.forEach((line, i) => {
          fragment.appendChild(document.createTextNode(line));
          if (i < lines.length - 1) fragment.appendChild(document.createElement('br'));
        });
        range.insertNode(fragment);
      } else {
        range.insertNode(document.createTextNode(enhancedText));
      }
    }

    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    editableElement.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  if (savedRange && canReplaceInPlace) {
    try {
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(savedRange);
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(enhancedText));
      selection.removeAllRanges();
      return true;
    } catch (e) {
      // fall through to clipboard
    }
  }

  navigator.clipboard?.writeText(enhancedText);
  showToast('This area is not editable — enhanced text copied to clipboard.', 'info', { duration: 4000 });
  return false;
}

function preserveLineBreaks(original, enhanced) {
  const origParaBreaks = (original.match(/\n\s*\n/g) || []).length;
  const enhancedParaBreaks = (enhanced.match(/\n\s*\n/g) || []).length;
  if (origParaBreaks > 0 && enhancedParaBreaks === 0 && enhanced.includes('\n')) {
    return enhanced;
  }
  return enhanced;
}

// ========== Undo System ==========

function saveUndoState(applySnapshot) {
  undoStack.push({ ...applySnapshot, timestamp: Date.now() });
  if (undoStack.length > MAX_UNDO) undoStack.shift();
}

function performUndo() {
  if (undoStack.length === 0) {
    showToast('Nothing to undo.', 'info');
    return;
  }

  const state = undoStack.pop();
  savedActiveElement = state.element;
  savedSelectionStart = state.start;
  savedSelectionEnd = state.end;
  savedRange = state.range?.cloneRange?.() || null;

  if (state.element && isTextInputElement(state.element)) {
    const el = state.element;
    if (!document.body.contains(el)) {
      showToast('Cannot undo — original field is no longer on the page.', 'warning');
      return;
    }
    const start = state.start;
    const end = state.end ?? (start + (state.enhancedText?.length || 0));
    el.focus();
    el.setSelectionRange(start, end);
    if (!document.execCommand('insertText', false, state.originalText)) {
      const val = el.value;
      setNativeInputValue(el, val.substring(0, start) + state.originalText + val.substring(end));
    } else {
      setNativeInputValue(el, el.value);
    }
    showToast('Undone!', 'success');
    return;
  }

  if (state.element?.isContentEditable && state.range) {
    if (!document.body.contains(state.element)) {
      showToast('Cannot undo — original field is no longer on the page.', 'warning');
      return;
    }
    state.element.focus();
    const selection = window.getSelection();
    selection.removeAllRanges();
    const range = state.range.cloneRange();
    selection.addRange(range);
    range.deleteContents();
    range.insertNode(document.createTextNode(state.originalText));
    state.element.dispatchEvent(new Event('input', { bubbles: true }));
    showToast('Undone!', 'success');
    return;
  }

  navigator.clipboard?.writeText(state.originalText);
  showToast('Original text copied to clipboard.', 'info');
}

// ========== Toasts ==========

function friendlyError(msg) {
  if (!msg) return 'Something went wrong. Open Scramble Settings to check your configuration.';
  if (/cancel/i.test(msg)) return msg;
  if (/401|403|Incorrect API key|invalid.*key|authentication/i.test(msg)) {
    return 'Invalid API key. Open Scramble Settings to update your key.';
  }
  if (/timed out|timeout/i.test(msg)) return 'Request timed out. Try again or check your connection.';
  if (/429|rate limit/i.test(msg)) return 'Rate limit reached. Please wait a moment and try again.';
  if (/not configured|not set/i.test(msg)) return `${msg} Open Scramble Settings to fix this.`;
  return msg;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function dismissToast() {
  document.getElementById('scramble-toast')?.remove();
}

function showLoadingToast(message, onCancel) {
  dismissToast();
  ensureStyles();

  const toast = document.createElement('div');
  toast.id = 'scramble-toast';
  toast.className = 'scramble-toast scramble-toast-loading';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.innerHTML = `
    <div class="scramble-spinner"></div>
    <span class="scramble-toast-message">${escapeHtml(message)}</span>
    <button type="button" class="scramble-toast-cancel" aria-label="Cancel">Cancel</button>
  `;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('scramble-toast-visible'));
  toast.querySelector('.scramble-toast-cancel')?.addEventListener('click', onCancel);
}

function showToast(message, type = 'info', opts = {}) {
  dismissToast();
  ensureStyles();

  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  const toast = document.createElement('div');
  toast.id = 'scramble-toast';
  toast.className = `scramble-toast scramble-toast-${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  toast.innerHTML = `
    <span class="scramble-toast-icon">${icons[type] || icons.info}</span>
    <span class="scramble-toast-message">${escapeHtml(message)}</span>
  `;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('scramble-toast-visible'));

  const duration = opts.duration ?? (type === 'error' ? 5000 : 3000);
  if (opts.persist !== true) {
    setTimeout(() => {
      toast.classList.remove('scramble-toast-visible');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
}

function getScrambleStyles() {
  const reducedMotion = '@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }';
  return reducedMotion + `
    #scramble-toolbar {
      position: absolute;
      z-index: 2147483646;
      opacity: 0;
      transform: translateY(-2px) scale(0.98);
      transition: opacity 0.15s ease, transform 0.15s ease;
      pointer-events: none;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      line-height: 1.35;
      color: #334155;
    }
    #scramble-toolbar.scramble-visible { opacity: 1; transform: none; pointer-events: auto; }
    #scramble-toolbar-inner {
      background: #fff;
      border: 1px solid rgba(0,0,0,0.08);
      border-radius: 10px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.12);
      min-width: 280px;
      max-width: 320px;
      overflow: hidden;
    }
    #scramble-toolbar-hint {
      padding: 6px 10px;
      font-size: 11px;
      color: #64748b;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
    }
    #scramble-toolbar-actions { max-height: 320px; overflow-y: auto; padding: 4px; }
    .scramble-action-btn {
      display: flex; align-items: center; gap: 8px; width: 100%;
      padding: 8px 10px; border: none; background: transparent;
      color: #475569; cursor: pointer; border-radius: 6px;
      font-size: 13px; text-align: left; font-family: inherit;
    }
    .scramble-action-btn:hover { background: #f1f5f9; color: #6366f1; }
    .scramble-action-icon { width: 18px; height: 18px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
    .scramble-action-icon svg { width: 16px; height: 16px; }
    .scramble-action-label { white-space: normal; word-break: break-word; line-height: 1.3; }
    .scramble-action-btn.scramble-undo { border-top: 1px solid #f1f5f9; margin-top: 2px; color: #94a3b8; }
    .scramble-toast {
      position: fixed; bottom: 20px; left: 20px; z-index: 2147483647;
      display: flex; align-items: center; gap: 8px; padding: 10px 14px;
      border-radius: 8px; font-family: inherit; font-size: 13px; font-weight: 500;
      box-shadow: 0 4px 16px rgba(0,0,0,0.15);
      transform: translateY(12px); opacity: 0;
      transition: transform 0.2s ease, opacity 0.2s ease;
      max-width: min(360px, calc(100vw - 40px));
    }
    .scramble-toast-visible { transform: none; opacity: 1; }
    .scramble-toast-success { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
    .scramble-toast-error { background: #fef2f2; color: #991b1b; border: 1px solid #fca5a5; }
    .scramble-toast-warning { background: #fffbeb; color: #92400e; border: 1px solid #fcd34d; }
    .scramble-toast-info { background: #eff6ff; color: #1e40af; border: 1px solid #93c5fd; }
    .scramble-toast-loading { background: #fafafa; color: #6366f1; border: 1px solid #e2e8f0; }
    .scramble-toast-cancel {
      margin-left: auto; padding: 2px 8px; border: 1px solid #cbd5e1;
      border-radius: 4px; background: #fff; color: #475569; cursor: pointer; font-size: 11px;
    }
    .scramble-spinner {
      width: 14px; height: 14px; border: 2px solid #e2e8f0;
      border-top-color: #6366f1; border-radius: 50%;
      animation: scramble-spin 0.6s linear infinite; flex-shrink: 0;
    }
    @keyframes scramble-spin { to { transform: rotate(360deg); } }
    #scramble-preview-overlay {
      position: fixed; inset: 0; z-index: 2147483647;
      background: rgba(15,23,42,0.72); display: flex; align-items: center; justify-content: center;
      padding: 16px; font-family: inherit; isolation: isolate;
    }
    #scramble-preview-overlay ~ #scramble-toolbar,
    body:has(#scramble-preview-overlay) #scramble-toolbar {
      display: none !important;
      pointer-events: none !important;
    }
    .scramble-preview-modal {
      position: relative; z-index: 1;
      background: #fff; border-radius: 12px; max-width: 720px; width: 100%;
      max-height: 85vh; display: flex; flex-direction: column;
      box-shadow: 0 20px 50px rgba(0,0,0,0.25);
    }
    .scramble-preview-header { padding: 16px 20px; border-bottom: 1px solid #e2e8f0; }
    .scramble-preview-header h3 { margin: 0 0 4px; font-size: 16px; color: #0f172a; }
    .scramble-preview-header p { margin: 0; font-size: 13px; color: #64748b; }
    .scramble-preview-panels { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 16px 20px; overflow: auto; flex: 1; }
    .scramble-preview-panel { display: flex; flex-direction: column; gap: 6px; min-height: 120px; }
    .scramble-preview-label { font-size: 11px; font-weight: 600; text-transform: uppercase; color: #64748b; letter-spacing: 0.04em; }
    .scramble-preview-text {
      flex: 1; padding: 10px; border-radius: 8px; border: 1px solid #e2e8f0;
      background: #f8fafc; font-size: 13px; line-height: 1.5; white-space: pre-wrap;
      overflow: auto; max-height: 240px;
    }
    .scramble-preview-panel-enhanced .scramble-preview-text { background: #eef2ff; border-color: #c7d2fe; }
    .scramble-preview-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px 16px; border-top: 1px solid #e2e8f0; }
    .scramble-preview-btn { padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; }
    .scramble-preview-reject { background: #f1f5f9; color: #475569; }
    .scramble-preview-accept { background: #6366f1; color: #fff; }
    @media (max-width: 600px) { .scramble-preview-panels { grid-template-columns: 1fr; } }
    @media (prefers-color-scheme: dark) {
      #scramble-toolbar-inner { background: #1e293b; border-color: #334155; }
      #scramble-toolbar-hint { background: #0f172a; color: #94a3b8; border-color: #334155; }
      .scramble-action-btn { color: #cbd5e1; }
      .scramble-action-btn:hover { background: #334155; color: #a5b4fc; }
      .scramble-toast-loading { background: #1e293b; color: #a5b4fc; border-color: #334155; }
      .scramble-preview-modal { background: #1e293b; }
      .scramble-preview-header { border-color: #334155; }
      .scramble-preview-header h3 { color: #f1f5f9; }
      .scramble-preview-text { background: #0f172a; border-color: #334155; color: #e2e8f0; }
      .scramble-preview-panel-enhanced .scramble-preview-text { background: #312e81; border-color: #4338ca; }
      .scramble-preview-actions { border-color: #334155; }
      .scramble-preview-reject { background: #334155; color: #e2e8f0; }
    }
    @media (prefers-contrast: more) {
      .scramble-action-btn:focus-visible, .scramble-preview-btn:focus-visible, .scramble-toast-cancel:focus-visible {
        outline: 3px solid #6366f1; outline-offset: 2px;
      }
    }
  `;
}

if (!SCRAMBLE_ALREADY_LOADED) {
  browserAPI.runtime.onMessage.addListener(handleRuntimeMessage);
  bindPageEventListeners();
}
