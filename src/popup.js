const browserAPI = (typeof browser !== 'undefined' ? browser : chrome);

const IS_MAC = navigator.platform.toUpperCase().includes('MAC');
const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';

document.addEventListener('DOMContentLoaded', async function() {
  const statusElement = document.getElementById('status');
  const optionsButton = document.getElementById('optionsButton');
  const versionElement = document.getElementById('version');
  const shortcutsEl = document.getElementById('shortcuts');

  // Platform-aware shortcut labels
  if (shortcutsEl) {
    shortcutsEl.innerHTML = `
      <div class="shortcut-row"><span>Fix grammar</span><span class="kbd"><kbd>${MOD_KEY}</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd></span></div>
      <div class="shortcut-row"><span>Improve writing</span><span class="kbd"><kbd>${MOD_KEY}</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd></span></div>
      <div class="shortcut-row"><span>Open toolbar</span><span class="kbd"><kbd>${MOD_KEY}</kbd>+<kbd>Shift</kbd>+<kbd>U</kbd></span></div>
    `;
  }

  try {
    const manifest = browserAPI.runtime.getManifest();
    if (versionElement && manifest.version) {
      versionElement.textContent = `v${manifest.version}`;
    }
  } catch (e) { /* ignore */ }

  try {
    const result = await new Promise((resolve) => {
      browserAPI.storage.sync.get({
        llmProvider: 'openai',
        apiKey: '',
        llmModel: '',
        onboardingComplete: false,
      }, resolve);
    });

    if (!statusElement) return;

    const providerNames = {
      openai: 'OpenAI', anthropic: 'Anthropic', ollama: 'Ollama',
      lmstudio: 'LM Studio', groq: 'Groq', openrouter: 'OpenRouter',
    };
    const providerName = providerNames[result.llmProvider] || result.llmProvider;
    const isLocal = ['ollama', 'lmstudio'].includes(result.llmProvider);
    const hasApiKey = !!result.apiKey;
    const hasModel = !!result.llmModel?.trim();

    if (!result.onboardingComplete && !hasApiKey && !hasModel) {
      statusElement.className = 'status-card warning';
      statusElement.setAttribute('role', 'status');
      statusElement.innerHTML = `
        <div class="status-dot yellow"></div>
        <div>
          <div>Welcome! Set up Scramble to get started.</div>
          <div class="provider-badge">Add your API key and model in Settings</div>
        </div>
      `;
    } else if (isLocal && !hasModel) {
      statusElement.className = 'status-card warning';
      statusElement.innerHTML = `
        <div class="status-dot yellow"></div>
        <div>
          <div>Model name required</div>
          <div class="provider-badge">${providerName} — configure model in Settings</div>
        </div>
      `;
    } else if (!isLocal && !hasApiKey) {
      statusElement.className = 'status-card warning';
      statusElement.innerHTML = `
        <div class="status-dot yellow"></div>
        <div>API key not set. Click Settings to configure.</div>
      `;
    } else {
      statusElement.className = 'status-card ready';
      statusElement.innerHTML = `
        <div class="status-dot green"></div>
        <div>
          <div>Ready to use</div>
          <div class="provider-badge">${providerName}${hasModel ? ` · ${result.llmModel}` : ''}</div>
        </div>
      `;
    }
  } catch (error) {
    statusElement.className = 'status-card error';
    statusElement.innerHTML = `
      <div class="status-dot red"></div>
      <div>Error checking extension status.</div>
    `;
  }

  optionsButton?.addEventListener('click', function() {
    try {
      if (browserAPI.runtime.openOptionsPage) {
        browserAPI.runtime.openOptionsPage();
      } else {
        window.open(browserAPI.runtime.getURL('options.html'));
      }
    } catch (error) {
      window.open(browserAPI.runtime.getURL('options.html'));
    }
  });
});
