const browserAPI = (typeof browser !== 'undefined' ? browser : chrome);

document.addEventListener('DOMContentLoaded', async function() {
  const statusElement = document.getElementById('status');
  const optionsButton = document.getElementById('optionsButton');
  const versionElement = document.getElementById('version');

  // Show version
  try {
    const manifest = browserAPI.runtime.getManifest();
    if (versionElement && manifest.version) {
      versionElement.textContent = `v${manifest.version}`;
    }
  } catch (e) {
    // Ignore
  }

  // Check status
  try {
    const result = await new Promise((resolve) => {
      browserAPI.storage.sync.get({
        llmProvider: 'openai',
        apiKey: '',
        llmModel: '',
      }, resolve);
    });

    if (result.apiKey) {
      const providerNames = {
        openai: 'OpenAI',
        anthropic: 'Anthropic',
        ollama: 'Ollama',
        lmstudio: 'LM Studio',
        groq: 'Groq',
        openrouter: 'OpenRouter',
      };
      const providerName = providerNames[result.llmProvider] || result.llmProvider;
      const model = result.llmModel || 'default';

      statusElement.className = 'status-card ready';
      statusElement.innerHTML = `
        <div class="status-dot green"></div>
        <div>
          <div>Ready to use</div>
          <div class="provider-badge">${providerName} · ${model}</div>
        </div>
      `;
    } else if (['ollama', 'lmstudio'].includes(result.llmProvider)) {
      // Local providers may not need API key
      statusElement.className = 'status-card ready';
      statusElement.innerHTML = `
        <div class="status-dot yellow"></div>
        <div>
          <div>Local provider configured</div>
          <div class="provider-badge">${result.llmProvider}</div>
        </div>
      `;
    } else {
      statusElement.className = 'status-card warning';
      statusElement.innerHTML = `
        <div class="status-dot yellow"></div>
        <div>API key not set. Click Settings to configure.</div>
      `;
    }
  } catch (error) {
    console.error('Error checking status:', error);
    statusElement.className = 'status-card error';
    statusElement.innerHTML = `
      <div class="status-dot red"></div>
      <div>Error checking extension status.</div>
    `;
  }

  // Open options
  optionsButton.addEventListener('click', function() {
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
