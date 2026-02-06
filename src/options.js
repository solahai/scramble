const browserAPI = (typeof browser !== 'undefined' ? browser : chrome);

const DEFAULT_SYSTEM_INSTRUCTION = 'You are a helpful writing assistant. You enhance, correct, and improve text while preserving the author\'s voice and intent. Always return only the processed text without any additional commentary, quotes, or explanation.';

// ========== Toggle Sections ==========

function toggleSection(sectionId) {
  const section = document.getElementById(sectionId);
  const chevron = document.getElementById(`${sectionId}-chevron`);
  if (section) {
    section.classList.toggle('collapsed');
    if (chevron) {
      chevron.style.transform = section.classList.contains('collapsed') ? 'rotate(-90deg)' : '';
    }
  }
}

// Make toggleSection available globally for onclick handlers
window.toggleSection = toggleSection;

// ========== Save Options ==========

async function saveOptions() {
  try {
    const options = {
      llmProvider: document.getElementById('llmProvider').value,
      apiKey: document.getElementById('apiKey').value.trim(),
      llmModel: document.getElementById('llmModel').value.trim(),
      customEndpoint: document.getElementById('customEndpoint').value.trim(),
      systemInstruction: document.getElementById('systemInstruction').value.trim() || DEFAULT_SYSTEM_INSTRUCTION,
      temperature: parseFloat(document.getElementById('temperature').value) || 0.7,
      maxTokens: parseInt(document.getElementById('maxTokens').value) || 2048,
      customPrompts: getCustomPrompts(),
    };

    // Validate
    if (!['ollama', 'lmstudio'].includes(options.llmProvider) && !options.apiKey) {
      showMessage('Please enter an API key for your provider.', 'warning');
      return;
    }

    await new Promise((resolve, reject) => {
      browserAPI.storage.sync.set(options, () => {
        if (browserAPI.runtime.lastError) {
          reject(browserAPI.runtime.lastError);
        } else {
          resolve();
        }
      });
    });

    showMessage('Settings saved successfully!', 'success');
  } catch (error) {
    console.error('Error saving options:', error);
    showMessage('Error saving settings. Please try again.', 'error');
  }
}

// ========== Custom Prompts ==========

function getCustomPrompts() {
  try {
    const promptContainers = document.querySelectorAll('.prompt-container');
    return Array.from(promptContainers).map(container => ({
      id: snakeCase(container.querySelector('.prompt-title').value || ''),
      title: container.querySelector('.prompt-title').value || '',
      prompt: container.querySelector('.prompt-text').value || ''
    })).filter(prompt => prompt.title && prompt.prompt);
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
          container.classList.add('opacity-0', 'scale-95');
          container.style.transition = 'all 0.2s ease';
          setTimeout(() => {
            container.remove();
          }, 200);
        });
      }
    }

    promptsContainer.appendChild(promptElement);
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
      llmModel: 'gpt-4o-mini',
      customEndpoint: '',
      customPrompts: [],
      systemInstruction: DEFAULT_SYSTEM_INSTRUCTION,
      temperature: 0.7,
      maxTokens: 2048,
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

    // Reset model dropdown
    if (availableModelsSelect) {
      availableModelsSelect.classList.add('hidden');
      availableModelsSelect.innerHTML = '<option value="">Select a model...</option>';
    }

    // Show fetch models for compatible providers
    const canFetchModels = ['openai', 'lmstudio', 'ollama', 'openrouter', 'groq'].includes(provider);
    if (fetchModelsButton) {
      fetchModelsButton.style.display = canFetchModels ? 'inline-flex' : 'none';
    }

    const configs = {
      openai: {
        label: 'OpenAI API Key',
        placeholder: 'sk-...',
        help: 'Get your API key from platform.openai.com/api-keys',
        model: 'gpt-4o-mini, gpt-4o, gpt-4-turbo, o1-mini',
        modelHelp: 'Recommended: gpt-4o-mini (fast & affordable) or gpt-4o (best quality)',
        endpoint: 'https://api.openai.com/v1/chat/completions (default)',
        endpointHelp: 'Leave empty to use default OpenAI endpoint',
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
        showApiKey: true,
      },
      lmstudio: {
        label: 'API Key (Optional)',
        placeholder: 'Leave empty for local LM Studio',
        help: 'LM Studio typically runs without API keys',
        model: 'Model name as shown in LM Studio',
        modelHelp: 'Use the exact model name from LM Studio',
        endpoint: 'http://localhost:1234/v1/chat/completions (default)',
        endpointHelp: 'Ensure LM Studio server is running',
        showApiKey: true,
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

function showMessage(message, type = 'info') {
  const status = document.getElementById('status');
  if (!status) return;

  const colors = {
    success: 'text-emerald-600',
    error: 'text-red-600',
    warning: 'text-amber-600',
    info: 'text-blue-600',
  };

  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ',
  };

  status.className = `text-sm flex items-center gap-2 ${colors[type] || colors.info}`;
  status.innerHTML = `<span>${icons[type] || ''}</span> ${message}`;

  if (type !== 'error') {
    setTimeout(() => {
      status.innerHTML = '';
    }, 3000);
  }
}

// ========== Initialize ==========

document.addEventListener('DOMContentLoaded', () => {
  restoreOptions();

  // Save
  const saveButton = document.getElementById('save');
  if (saveButton) saveButton.addEventListener('click', saveOptions);

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
        apiKeyInput.classList.toggle('revealed');
        apiKeyInput.classList.toggle('api-key-field');
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
