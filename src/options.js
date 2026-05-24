const browserAPI = (typeof browser !== 'undefined' ? browser : chrome);

const DEFAULT_SYSTEM_INSTRUCTION = 'You are a helpful writing assistant. You enhance, correct, and improve text while preserving the author\'s voice and intent. IMPORTANT: Preserve the original paragraph structure and line breaks exactly as they appear. Do not merge paragraphs or remove line breaks. Always return only the processed text without any additional commentary, quotes, or explanation.';

let isDirty = false;
let savedSnapshot = '';

function markDirty() {
  isDirty = true;
}

function clearDirty() {
  isDirty = false;
  savedSnapshot = getFormSnapshot();
}

function getFormSnapshot() {
  return JSON.stringify({
    llmProvider: document.getElementById('llmProvider')?.value,
    apiKey: document.getElementById('apiKey')?.value,
    llmModel: document.getElementById('llmModel')?.value,
    customEndpoint: document.getElementById('customEndpoint')?.value,
    systemInstruction: document.getElementById('systemInstruction')?.value,
    showPreview: document.getElementById('showPreview')?.checked,
    customPrompts: getCustomPrompts(),
  });
}

// ========== Toggle Sections ==========

function toggleSection(sectionId, toggleBtn) {
  const section = document.getElementById(sectionId);
  const chevron = document.getElementById(`${sectionId}-chevron`);
  const btn = toggleBtn || document.getElementById(`${sectionId}-toggle`);
  if (section) {
    section.classList.toggle('collapsed');
    const collapsed = section.classList.contains('collapsed');
    if (chevron) chevron.style.transform = collapsed ? 'rotate(-90deg)' : '';
    if (btn) btn.setAttribute('aria-expanded', String(!collapsed));
  }
}

window.toggleSection = toggleSection;

// ========== Save Options ==========

async function saveOptions() {
  const saveButton = document.getElementById('save');
  if (saveButton?.disabled) return;

  try {
    const options = {
      llmProvider: document.getElementById('llmProvider').value,
      apiKey: document.getElementById('apiKey').value.trim(),
      llmModel: document.getElementById('llmModel').value.trim(),
      customEndpoint: document.getElementById('customEndpoint').value.trim(),
      systemInstruction: document.getElementById('systemInstruction').value.trim() || DEFAULT_SYSTEM_INSTRUCTION,
      temperature: parseFloat(document.getElementById('temperature').value) || 0.7,
      maxTokens: parseInt(document.getElementById('maxTokens').value) || 2048,
      showPreview: document.getElementById('showPreview').checked,
      customPrompts: getCustomPrompts(),
      onboardingComplete: true,
    };

    if (!['ollama', 'lmstudio'].includes(options.llmProvider) && !options.apiKey) {
      showMessage('Please enter an API key for your provider.', 'warning');
      return;
    }

    if (['ollama', 'lmstudio'].includes(options.llmProvider) && !options.llmModel) {
      showMessage('Please enter a model name for your local provider.', 'warning');
      return;
    }

    if (!options.llmModel) {
      showMessage('Please enter a model name.', 'warning');
      return;
    }

    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = 'Saving…';
    }

    await new Promise((resolve, reject) => {
      browserAPI.storage.sync.set(options, () => {
        if (browserAPI.runtime.lastError) {
          reject(new Error(browserAPI.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });

    clearDirty();
    document.getElementById('onboarding-banner')?.classList.add('hidden');
    showMessage('Settings saved successfully!', 'success', 6000);
  } catch (error) {
    console.error('Error saving options:', error);
    const msg = /QUOTA|quota|MAX_WRITE|max/i.test(error.message)
      ? 'Settings too large for sync storage. Try shortening system instructions or removing custom prompts.'
      : 'Error saving settings. Please try again.';
    showMessage(msg, 'error');
  } finally {
    const saveButton = document.getElementById('save');
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = 'Save Changes';
    }
  }
}

// ========== Custom Prompts ==========

const RESERVED_PROMPT_IDS = new Set([
  'fix_grammar', 'improve_writing', 'make_professional', 'simplify', 'summarize',
  'expand', 'bullet_points', 'make_friendly', 'make_concise', 'translate_english', 'scramble',
]);

function getCustomPrompts() {
  try {
    const promptContainers = document.querySelectorAll('.prompt-container');
    const usedIds = new Set();
    return Array.from(promptContainers).map(container => {
      const title = container.querySelector('.prompt-title').value || '';
      const prompt = container.querySelector('.prompt-text').value || '';
      const existingId = container.querySelector('.prompt-id')?.value;
      let id = existingId || snakeCase(title);
      while (!id || usedIds.has(id) || RESERVED_PROMPT_IDS.has(id)) {
        id = `${snakeCase(title) || 'custom'}_${usedIds.size + 1}`;
      }
      usedIds.add(id);
      return { id, title, prompt };
    }).filter(p => p.title && p.prompt);
  } catch (error) {
    console.error('Error getting custom prompts:', error);
    return [];
  }
}

function snakeCase(str) {
  return str.toLowerCase().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function addPromptToUI(title = '', prompt = '', id = '') {
  try {
    const promptsContainer = document.getElementById('prompts-container');
    const template = document.getElementById('prompt-template');

    if (!promptsContainer || !template) {
      throw new Error('Required elements not found');
    }

    const promptElement = template.content.cloneNode(true);
    const titleInput = promptElement.querySelector('.prompt-title');
    const textInput = promptElement.querySelector('.prompt-text');

    if (titleInput && textInput) {
      titleInput.value = title;
      textInput.value = prompt;
    }

    const idInput = document.createElement('input');
    idInput.type = 'hidden';
    idInput.className = 'prompt-id';
    idInput.value = id || snakeCase(title);

    const container = promptElement.querySelector('.prompt-container');
    if (container) {
      container.appendChild(idInput);

      const deleteButton = container.querySelector('.delete-prompt');
      if (deleteButton) {
        deleteButton.addEventListener('click', function () {
          if (!confirm('Delete this custom prompt? This cannot be undone until you save.')) return;
          container.classList.add('opacity-0', 'scale-95');
          container.style.transition = 'all 0.2s ease';
          setTimeout(() => {
            container.remove();
            markDirty();
          }, 200);
        });
      }
    }

    promptsContainer.appendChild(promptElement);
    markDirty();
  } catch (error) {
    console.error('Error adding prompt to UI:', error);
    showMessage('Error adding new prompt.', 'error');
  }
}

// ========== Restore Options ==========

async function restoreOptions() {
  try {
    const defaults = {
      llmProvider: 'openai',
      apiKey: '',
      llmModel: 'gpt-5.2',
      customEndpoint: '',
      customPrompts: [],
      systemInstruction: DEFAULT_SYSTEM_INSTRUCTION,
      temperature: 0.7,
      maxTokens: 2048,
      showPreview: true,
      onboardingComplete: false,
    };

    const items = await new Promise(resolve => {
      browserAPI.storage.sync.get(defaults, resolve);
    });

    // Restore simple fields
    const fields = ['llmProvider', 'apiKey', 'llmModel', 'customEndpoint', 'systemInstruction'];
    fields.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = items[id] || defaults[id];
    });

    // Restore temperature
    const tempEl = document.getElementById('temperature');
    const tempValueEl = document.getElementById('temperatureValue');
    if (tempEl) {
      tempEl.value = items.temperature ?? 0.7;
      if (tempValueEl) tempValueEl.textContent = tempEl.value;
    }

    // Restore max tokens
    const maxTokensEl = document.getElementById('maxTokens');
    if (maxTokensEl) maxTokensEl.value = items.maxTokens ?? 2048;

    const showPreviewEl = document.getElementById('showPreview');
    if (showPreviewEl) showPreviewEl.checked = items.showPreview !== false;

    if (!items.onboardingComplete) {
      document.getElementById('onboarding-banner')?.classList.remove('hidden');
    }

    // Clear existing prompts before restoring
    const promptsContainer = document.getElementById('prompts-container');
    while (promptsContainer.firstChild) {
      promptsContainer.removeChild(promptsContainer.firstChild);
    }

    // Restore custom prompts
    if (items.customPrompts && items.customPrompts.length > 0) {
      items.customPrompts.forEach(prompt => {
        addPromptToUI(prompt.title, prompt.prompt, prompt.id);
      });
    }

    updateUIForProvider(items.llmProvider);
    clearDirty();
  } catch (error) {
    console.error('Error restoring options:', error);
    showMessage('Error loading settings. Please try reloading the page.', 'error');
  }
}

// ========== Provider UI Updates ==========

function updateUIForProvider(provider) {
  try {
    const apiKeyLabel = document.getElementById('apiKeyLabel');
    const apiKeyInput = document.getElementById('apiKey');
    const apiKeyHelp = document.getElementById('apiKeyHelp');
    const llmModelInput = document.getElementById('llmModel');
    const modelHelp = document.getElementById('modelHelp');
    const customEndpointInput = document.getElementById('customEndpoint');
    const endpointHelp = document.getElementById('endpointHelp');
    const fetchModelsButton = document.getElementById('fetchModels');
    const availableModelsSelect = document.getElementById('availableModels');
    const apiKeyWrapper = document.getElementById('apiKeyFieldWrapper');

    // Reset model dropdown
    if (availableModelsSelect) {
      availableModelsSelect.classList.add('hidden');
      availableModelsSelect.innerHTML = '<option value="">Select a model...</option>';
    }

    // Show fetch models for compatible providers
    const canFetchModels = ['openai', 'anthropic', 'lmstudio', 'ollama', 'openrouter', 'groq'].includes(provider);
    if (fetchModelsButton) {
      fetchModelsButton.style.display = canFetchModels ? 'inline-flex' : 'none';
    }

    const configs = {
      openai: {
        label: 'OpenAI API Key',
        placeholder: 'sk-...',
        help: 'Get your API key from platform.openai.com/api-keys',
        model: 'gpt-5.2, gpt-5, gpt-4.1, gpt-4o-mini',
        modelHelp: 'Recommended: gpt-5.2 (newest) or gpt-4.1 (fast & capable)',
        endpoint: 'Uses Responses API by default',
        endpointHelp: 'Leave empty to use the OpenAI Responses API. Only set a custom endpoint for proxies or compatible services.',
        showApiKey: true,
      },
      anthropic: {
        label: 'Anthropic API Key',
        placeholder: 'sk-ant-...',
        help: 'Get your API key from console.anthropic.com',
        model: 'claude-3-5-sonnet-20241022, claude-3-5-haiku-20241022',
        modelHelp: 'Recommended: claude-3-5-sonnet (best) or claude-3-5-haiku (fast)',
        endpoint: 'https://api.anthropic.com/v1/messages (default)',
        endpointHelp: 'Leave empty to use default Anthropic endpoint',
        showApiKey: true,
      },
      ollama: {
        label: 'API Key (Optional)',
        placeholder: 'Leave empty for local Ollama',
        help: 'Only needed for remote Ollama instances',
        model: 'llama3.2, mistral, codellama, etc.',
        modelHelp: 'Run "ollama list" to see available models',
        endpoint: 'http://localhost:11434/api/generate (default)',
        endpointHelp: 'Make sure Ollama is running locally',
        showApiKey: false,
      },
      lmstudio: {
        label: 'API Key (Optional)',
        placeholder: 'Leave empty for local LM Studio',
        help: 'LM Studio typically runs without API keys',
        model: 'Model name as shown in LM Studio',
        modelHelp: 'Use the exact model name from LM Studio',
        endpoint: 'http://localhost:1234/v1/chat/completions (default)',
        endpointHelp: 'Ensure LM Studio server is running',
        showApiKey: false,
      },
      groq: {
        label: 'Groq API Key',
        placeholder: 'gsk_...',
        help: 'Get your API key from console.groq.com/keys',
        model: 'llama-3.3-70b-versatile, mixtral-8x7b-32768',
        modelHelp: 'Groq offers blazing fast inference',
        endpoint: 'https://api.groq.com/openai/v1/chat/completions (default)',
        endpointHelp: 'Leave empty to use default Groq endpoint',
        showApiKey: true,
      },
      openrouter: {
        label: 'OpenRouter API Key',
        placeholder: 'sk-or-...',
        help: 'Get your API key from openrouter.ai/keys',
        model: 'openai/gpt-4o-mini, anthropic/claude-3-5-sonnet',
        modelHelp: 'Format: provider/model-name — access 100+ models',
        endpoint: 'https://openrouter.ai/api/v1/chat/completions (default)',
        endpointHelp: 'Leave empty to use default OpenRouter endpoint',
        showApiKey: true,
      },
    };

    const config = configs[provider];
    if (!config) return;

    if (apiKeyLabel) apiKeyLabel.textContent = config.label;
    if (apiKeyInput) apiKeyInput.placeholder = config.placeholder;
    if (apiKeyHelp) apiKeyHelp.textContent = config.help;
    if (llmModelInput) llmModelInput.placeholder = config.model;
    if (modelHelp) modelHelp.textContent = config.modelHelp;
    if (customEndpointInput) customEndpointInput.placeholder = config.endpoint;
    if (endpointHelp) endpointHelp.textContent = config.endpointHelp;
    if (apiKeyWrapper) {
      apiKeyWrapper.style.display = config.showApiKey ? 'block' : 'none';
    }
  } catch (error) {
    console.error('Error updating UI for provider:', error);
  }
}

// ========== Fetch Models ==========

async function fetchAvailableModels() {
  const provider = document.getElementById('llmProvider').value;
  const apiKey = document.getElementById('apiKey').value;
  const customEndpoint = document.getElementById('customEndpoint').value;
  const fetchButton = document.getElementById('fetchModels');
  const fetchText = document.getElementById('fetchModelsText');
  const fetchSpinner = document.getElementById('fetchModelsSpinner');
  const availableModelsSelect = document.getElementById('availableModels');

  fetchButton.disabled = true;
  if (fetchText) fetchText.classList.add('hidden');
  if (fetchSpinner) fetchSpinner.classList.remove('hidden');

  try {
    let endpoint, headers = {};

    switch (provider) {
      case 'openai':
        endpoint = customEndpoint ? customEndpoint.replace('/chat/completions', '/models') : 'https://api.openai.com/v1/models';
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        break;
      case 'lmstudio':
        const baseUrl = customEndpoint ? customEndpoint.split('/v1')[0] : 'http://localhost:1234';
        endpoint = `${baseUrl}/v1/models`;
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        break;
      case 'ollama':
        const ollamaBaseUrl = customEndpoint ? customEndpoint.split('/api')[0] : 'http://localhost:11434';
        endpoint = `${ollamaBaseUrl}/api/tags`;
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        break;
      case 'openrouter':
        endpoint = 'https://openrouter.ai/api/v1/models';
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        break;
      case 'groq':
        endpoint = customEndpoint ? customEndpoint.replace('/chat/completions', '/models') : 'https://api.groq.com/openai/v1/models';
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        break;
      case 'anthropic':
        endpoint = 'https://api.anthropic.com/v1/models';
        if (apiKey) {
          headers['x-api-key'] = apiKey;
          headers['anthropic-version'] = '2023-06-01';
          headers['anthropic-dangerous-direct-browser-access'] = 'true';
        }
        break;
      default:
        throw new Error(`Model fetching not supported for ${provider}`);
    }

    const response = await fetch(endpoint, { headers });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    let models = [];

    switch (provider) {
      case 'ollama':
        models = data.models ? data.models.map(m => ({ id: m.name, name: m.name })) : [];
        break;
      case 'openrouter':
        models = data.data ? data.data.map(m => ({ id: m.id, name: m.name || m.id })) : [];
        break;
      case 'anthropic':
        models = data.data ? data.data.map(m => ({ id: m.id, name: m.display_name || m.id })) : [];
        break;
      default:
        models = data.data ? data.data.map(m => ({ id: m.id, name: m.id })) : [];
        break;
    }

    // Sort alphabetically
    models.sort((a, b) => a.name.localeCompare(b.name));

    availableModelsSelect.innerHTML = '<option value="">Select a model...</option>';
    models.forEach(model => {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.name;
      availableModelsSelect.appendChild(option);
    });

    availableModelsSelect.classList.remove('hidden');
    showMessage(`Found ${models.length} models`, 'success');
  } catch (error) {
    console.error('Error fetching models:', error);
    showMessage(`Failed to fetch models: ${error.message}`, 'error');
  } finally {
    fetchButton.disabled = false;
    if (fetchText) fetchText.classList.remove('hidden');
    if (fetchSpinner) fetchSpinner.classList.add('hidden');
  }
}

// ========== Status Messages ==========

function friendlySettingsError(message) {
  if (/401|403|Incorrect API key|invalid.*key|authentication/i.test(message)) {
    return 'Invalid API key. Check your key in the fields above and try again.';
  }
  if (/timed out|timeout/i.test(message)) return 'Connection timed out. Check your network and endpoint URL.';
  return message;
}

function showMessage(message, type = 'info', duration = 3000) {
  const status = document.getElementById('status');
  if (!status) return;

  const colors = {
    success: 'text-emerald-600',
    error: 'text-red-600',
    warning: 'text-amber-600',
    info: 'text-blue-600',
  };

  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  const display = type === 'error' ? friendlySettingsError(message) : message;

  status.className = `text-sm flex items-center gap-2 ${colors[type] || colors.info}`;
  status.innerHTML = `<span>${icons[type] || ''}</span> ${display}`;

  if (type !== 'error') {
    setTimeout(() => { status.innerHTML = ''; }, duration);
  }
}

async function testConnection() {
  const btn = document.getElementById('testConnection');
  if (btn) { btn.disabled = true; btn.textContent = 'Testing…'; }

  try {
    const config = {
      llmProvider: document.getElementById('llmProvider').value,
      apiKey: document.getElementById('apiKey').value.trim(),
      llmModel: document.getElementById('llmModel').value.trim(),
      customEndpoint: document.getElementById('customEndpoint').value.trim(),
      temperature: parseFloat(document.getElementById('temperature').value) || 0.7,
      maxTokens: parseInt(document.getElementById('maxTokens').value) || 2048,
    };

    if (!['ollama', 'lmstudio'].includes(config.llmProvider) && !config.apiKey) {
      showMessage('Enter an API key before testing.', 'warning');
      return;
    }
    if (!config.llmModel) {
      showMessage('Enter a model name before testing.', 'warning');
      return;
    }

    const response = await browserAPI.runtime.sendMessage({ action: 'testConnection', config });
    if (response?.success) {
      showMessage(`${response.message} Sample: "${response.sample}…"`, 'success', 8000);
    } else {
      showMessage(friendlySettingsError(response?.error || 'Connection test failed.'), 'error');
    }
  } catch (error) {
    showMessage(friendlySettingsError(error.message), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Test Connection'; }
  }
}

// ========== Initialize ==========

document.addEventListener('DOMContentLoaded', () => {
  restoreOptions();

  ['system-section', 'llm-section', 'prompts-section'].forEach(id => {
    const btn = document.getElementById(`${id}-toggle`);
    if (btn) {
      btn.addEventListener('click', () => toggleSection(id, btn));
    }
  });

  document.querySelectorAll('input, select, textarea').forEach(el => {
    el.addEventListener('input', () => {
      if (savedSnapshot && getFormSnapshot() !== savedSnapshot) markDirty();
    });
    el.addEventListener('change', () => {
      if (savedSnapshot && getFormSnapshot() !== savedSnapshot) markDirty();
    });
  });

  window.addEventListener('beforeunload', (e) => {
    if (isDirty || (savedSnapshot && getFormSnapshot() !== savedSnapshot)) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  const saveButton = document.getElementById('save');
  if (saveButton) saveButton.addEventListener('click', saveOptions);

  const testBtn = document.getElementById('testConnection');
  if (testBtn) testBtn.addEventListener('click', testConnection);

  // Provider change
  const providerSelect = document.getElementById('llmProvider');
  if (providerSelect) {
    providerSelect.addEventListener('change', (e) => updateUIForProvider(e.target.value));
  }

  // Add prompt
  const addPromptButton = document.getElementById('add-prompt');
  if (addPromptButton) {
    addPromptButton.addEventListener('click', () => addPromptToUI());
  }

  // Fetch models
  const fetchModelsButton = document.getElementById('fetchModels');
  if (fetchModelsButton) {
    fetchModelsButton.addEventListener('click', fetchAvailableModels);
  }

  // Model select
  const availableModelsSelect = document.getElementById('availableModels');
  if (availableModelsSelect) {
    availableModelsSelect.addEventListener('change', (e) => {
      if (e.target.value) {
        document.getElementById('llmModel').value = e.target.value;
        markDirty();
      }
    });
  }

  // Temperature slider
  const tempSlider = document.getElementById('temperature');
  const tempValue = document.getElementById('temperatureValue');
  if (tempSlider && tempValue) {
    tempSlider.addEventListener('input', (e) => {
      tempValue.textContent = e.target.value;
    });
  }

  // Reset system instruction
  const resetBtn = document.getElementById('resetSystemInstruction');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      const textarea = document.getElementById('systemInstruction');
      if (textarea) {
        textarea.value = DEFAULT_SYSTEM_INSTRUCTION;
        markDirty();
        showMessage('System instruction reset to default.', 'info');
      }
    });
  }

  // Toggle API key visibility
  const toggleApiKey = document.getElementById('toggleApiKey');
  if (toggleApiKey) {
    toggleApiKey.addEventListener('click', () => {
      const apiKeyInput = document.getElementById('apiKey');
      if (apiKeyInput) {
        const revealed = apiKeyInput.type === 'text';
        apiKeyInput.type = revealed ? 'password' : 'text';
        apiKeyInput.classList.toggle('revealed', !revealed);
        apiKeyInput.classList.toggle('api-key-field', revealed);
      }
    });
  }

  // Keyboard shortcut: Ctrl/Cmd + S to save
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveOptions();
    }
  });
});
