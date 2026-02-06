const browserAPI = (typeof browser !== 'undefined' ? browser : chrome);

const DEFAULT_PROMPTS = [
  { id: 'fix_grammar', title: 'Fix spelling & grammar', prompt: 'Fix the spelling and grammar. Return only the corrected text without quotes, explanations, or additional text:' },
  { id: 'improve_writing', title: 'Improve writing', prompt: 'Enhance the following text to improve clarity, flow, and readability. Return only the improved text without quotes, explanations, or additional text:' },
  { id: 'make_professional', title: 'Make professional', prompt: 'Rewrite the text in a formal, professional tone suitable for business communication. Return only the rewritten text without quotes, explanations, or additional text:' },
  { id: 'simplify', title: 'Simplify text', prompt: 'Simplify this text using simpler words and shorter sentences while preserving all key information. Return only the simplified text without quotes, explanations, or additional text:' },
  { id: 'summarize', title: 'Summarize', prompt: 'Provide a concise summary capturing all key points. Return only the summary without quotes, explanations, or additional text:' },
  { id: 'expand', title: 'Expand text', prompt: 'Elaborate on this text with more details, examples, and supporting points. Return only the expanded text without quotes, explanations, or additional text:' },
  { id: 'bullet_points', title: 'To bullet points', prompt: 'Convert this text into clear, organized bullet points. Return only the bullet-point list without quotes, explanations, or additional text:' },
  { id: 'make_friendly', title: 'Make friendly & casual', prompt: 'Rewrite this text in a warm, friendly, and casual tone. Return only the rewritten text without quotes, explanations, or additional text:' },
  { id: 'make_concise', title: 'Make concise', prompt: 'Shorten this text to be as concise as possible while preserving the core message. Remove filler words and redundancy. Return only the concise text without quotes, explanations, or additional text:' },
  { id: 'translate_english', title: 'Translate to English', prompt: 'Translate the following text to English. Return only the translated text without quotes, explanations, or additional text:' },
];

const DEFAULT_SYSTEM_INSTRUCTION = 'You are a helpful writing assistant. You enhance, correct, and improve text while preserving the author\'s voice and intent. Always return only the processed text without any additional commentary, quotes, or explanation.';

const CONFIG_DEFAULTS = {
  apiKey: '',
  llmProvider: 'openai',
  llmModel: 'gpt-4o-mini',
  customEndpoint: '',
  customPrompts: [],
  systemInstruction: DEFAULT_SYSTEM_INSTRUCTION,
  temperature: 0.7,
  maxTokens: 2048,
};

// --- Installation & Setup ---

if (typeof importScripts === 'function') {
  browserAPI.runtime.onInstalled.addListener(handleInstall);
} else {
  handleInstall({ reason: 'install' });
}

async function handleInstall(details) {
  if (details.reason === 'install') {
    log('Scramble installed. Welcome!');
    // Set defaults on first install
    const existing = await getConfig();
    if (!existing.apiKey) {
      await browserAPI.storage.sync.set(CONFIG_DEFAULTS);
    }
  } else if (details.reason === 'update') {
    log(`Extension updated to v${browserAPI.runtime.getManifest().version}`);
  }
  await updateContextMenu();
}

// --- Context Menu ---

async function updateContextMenu() {
  try {
    await browserAPI.contextMenus.removeAll();
    const config = await getConfig();
    const customPrompts = config.customPrompts || [];
    const allPrompts = [...DEFAULT_PROMPTS, ...customPrompts];

    await browserAPI.contextMenus.create({
      id: 'scramble',
      title: 'Scramble',
      contexts: ['selection'],
    });

    for (const prompt of allPrompts) {
      await browserAPI.contextMenus.create({
        id: prompt.id,
        parentId: 'scramble',
        title: prompt.title,
        contexts: ['selection'],
      });
    }
  } catch (error) {
    console.error('Error updating context menu:', error);
  }
}

browserAPI.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && (changes.customPrompts || changes.systemInstruction)) {
    updateContextMenu();
  }
});

// --- Content Script Injection ---

async function injectContentScript(tabId) {
  try {
    if (browserAPI === chrome && chrome.scripting) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });
    } else if (typeof browser !== 'undefined') {
      await browser.tabs.executeScript(tabId, { file: 'content.js' });
    }
  } catch (error) {
    console.error('Failed to inject content script:', error);
    throw error;
  }
}

// --- Context Menu Click Handler ---

browserAPI.contextMenus.onClicked.addListener((info, tab) => {
  browserAPI.storage.sync.get('customPrompts', async ({ customPrompts = [] }) => {
    const allPrompts = [...DEFAULT_PROMPTS, ...customPrompts];
    if (allPrompts.some(prompt => prompt.id === info.menuItemId)) {
      try {
        try {
          await browserAPI.tabs.sendMessage(tab.id, { action: 'ping' });
          await sendEnhanceTextMessage(tab.id, info.menuItemId, info.selectionText);
        } catch {
          await injectContentScript(tab.id);
          // Small delay to let content script initialize
          await new Promise(r => setTimeout(r, 100));
          await sendEnhanceTextMessage(tab.id, info.menuItemId, info.selectionText);
        }
      } catch (error) {
        console.error('Error handling context menu click:', error);
      }
    }
  });
});

async function sendEnhanceTextMessage(tabId, promptId, selectedText) {
  try {
    await browserAPI.tabs.sendMessage(tabId, {
      action: 'enhanceText',
      promptId: promptId,
      selectedText: selectedText,
    });
  } catch (error) {
    console.error('Error sending enhance message:', error);
    throw error;
  }
}

// --- Message Handler ---

browserAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'enhanceText') {
    enhanceTextWithRateLimit(request.promptId, request.selectedText)
      .then(enhancedText => {
        sendResponse({ success: true, enhancedText });
      })
      .catch(error => {
        log(`Error enhancing text: ${error.message}`, 'error');
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep message channel open for async response
  }

  if (request.action === 'getConfig') {
    getConfig().then(config => {
      sendResponse({ success: true, config });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  if (request.action === 'getPrompts') {
    getConfig().then(config => {
      const allPrompts = [...DEFAULT_PROMPTS, ...(config.customPrompts || [])];
      sendResponse({ success: true, prompts: allPrompts });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  return false;
});

// --- Keyboard Shortcut Handler ---

if (browserAPI.commands) {
  browserAPI.commands.onCommand.addListener(async (command) => {
    if (command === 'fix-grammar') {
      const [tab] = await browserAPI.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        try {
          await browserAPI.tabs.sendMessage(tab.id, { action: 'ping' });
        } catch {
          await injectContentScript(tab.id);
          await new Promise(r => setTimeout(r, 100));
        }
        await browserAPI.tabs.sendMessage(tab.id, {
          action: 'triggerFromShortcut',
          promptId: 'fix_grammar'
        });
      }
    } else if (command === 'improve-writing') {
      const [tab] = await browserAPI.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        try {
          await browserAPI.tabs.sendMessage(tab.id, { action: 'ping' });
        } catch {
          await injectContentScript(tab.id);
          await new Promise(r => setTimeout(r, 100));
        }
        await browserAPI.tabs.sendMessage(tab.id, {
          action: 'triggerFromShortcut',
          promptId: 'improve_writing'
        });
      }
    } else if (command === 'open-toolbar') {
      const [tab] = await browserAPI.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        try {
          await browserAPI.tabs.sendMessage(tab.id, { action: 'ping' });
        } catch {
          await injectContentScript(tab.id);
          await new Promise(r => setTimeout(r, 100));
        }
        await browserAPI.tabs.sendMessage(tab.id, { action: 'showToolbar' });
      }
    }
  });
}

// --- LLM Enhancement ---

async function enhanceTextWithLLM(promptId, text) {
  const config = await getConfig();

  if (!config.llmProvider) {
    throw new Error('LLM provider not configured. Please open Scramble settings.');
  }

  const allPrompts = [...DEFAULT_PROMPTS, ...(config.customPrompts || [])];
  const promptObj = allPrompts.find(p => p.id === promptId);
  if (!promptObj) {
    throw new Error('Invalid prompt selected.');
  }

  const fullPrompt = `${promptObj.prompt}\n\n${text}`;
  const systemInstruction = config.systemInstruction || DEFAULT_SYSTEM_INSTRUCTION;

  const enhanceFunctions = {
    openai: enhanceWithOpenAI,
    anthropic: enhanceWithAnthropic,
    ollama: enhanceWithOllama,
    lmstudio: enhanceWithLMStudio,
    groq: enhanceWithGroq,
    openrouter: enhanceWithOpenRouter,
  };

  const enhanceFunction = enhanceFunctions[config.llmProvider];
  if (!enhanceFunction) {
    throw new Error(`Unsupported provider: ${config.llmProvider}`);
  }

  return await enhanceFunction(fullPrompt, systemInstruction, config);
}

// --- Provider Implementations ---

async function enhanceWithOpenAI(prompt, systemInstruction, config) {
  if (!config.apiKey) {
    throw new Error('OpenAI API key not set. Please configure it in Scramble settings.');
  }

  const endpoint = config.customEndpoint || 'https://api.openai.com/v1/chat/completions';

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.llmModel || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: prompt }
      ],
      max_tokens: config.maxTokens || 2048,
      temperature: config.temperature ?? 0.7,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`OpenAI API error (${response.status}): ${errorData?.error?.message || response.statusText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

async function enhanceWithAnthropic(prompt, systemInstruction, config) {
  if (!config.apiKey) {
    throw new Error('Anthropic API key not set. Please configure it in Scramble settings.');
  }

  const endpoint = config.customEndpoint || 'https://api.anthropic.com/v1/messages';

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: config.llmModel || 'claude-3-5-sonnet-20241022',
      system: systemInstruction,
      messages: [
        { role: 'user', content: prompt }
      ],
      max_tokens: config.maxTokens || 2048,
      temperature: config.temperature ?? 0.7,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Anthropic API error (${response.status}): ${errorData?.error?.message || response.statusText}`);
  }

  const data = await response.json();
  return data.content[0].text.trim();
}

async function enhanceWithOllama(prompt, systemInstruction, config) {
  if (!config.llmModel) {
    throw new Error('Model not set for Ollama. Please configure it in Scramble settings.');
  }

  const endpoint = config.customEndpoint || 'http://localhost:11434/api/generate';

  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.llmModel,
      system: systemInstruction,
      prompt: prompt,
      stream: false,
      options: {
        temperature: config.temperature ?? 0.7,
        top_p: 0.9,
        top_k: 40,
      }
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Ollama API error (${response.status}): ${errorText || response.statusText}`);
  }

  const data = await response.json();
  if (!data.response) {
    throw new Error('Invalid response from Ollama API.');
  }
  return data.response.trim();
}

async function enhanceWithLMStudio(prompt, systemInstruction, config) {
  if (!config.llmModel) {
    throw new Error('Model not set for LM Studio. Please configure it in Scramble settings.');
  }

  const endpoint = config.customEndpoint || 'http://localhost:1234/v1/chat/completions';

  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.llmModel,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: prompt }
      ],
      max_tokens: config.maxTokens || 2048,
      temperature: config.temperature ?? 0.7,
      stream: false
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`LM Studio API error (${response.status}): ${errorText || response.statusText}`);
  }

  const data = await response.json();
  if (!data.choices?.[0]?.message) {
    throw new Error('Invalid response from LM Studio API.');
  }
  return data.choices[0].message.content.trim();
}

async function enhanceWithGroq(prompt, systemInstruction, config) {
  if (!config.apiKey) {
    throw new Error('Groq API key not set. Please configure it in Scramble settings.');
  }

  const endpoint = config.customEndpoint || 'https://api.groq.com/openai/v1/chat/completions';

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.llmModel || 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: prompt }
      ],
      max_tokens: config.maxTokens || 2048,
      temperature: config.temperature ?? 0.7,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Groq API error (${response.status}): ${errorData?.error?.message || response.statusText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

async function enhanceWithOpenRouter(prompt, systemInstruction, config) {
  if (!config.apiKey) {
    throw new Error('OpenRouter API key not set. Please configure it in Scramble settings.');
  }

  const endpoint = config.customEndpoint || 'https://openrouter.ai/api/v1/chat/completions';

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
      'X-Title': 'Scramble Browser Extension',
      'HTTP-Referer': 'https://github.com/nicholasgriffintn/scramble',
    },
    body: JSON.stringify({
      model: config.llmModel || 'openai/gpt-4o-mini',
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: prompt }
      ],
      max_tokens: config.maxTokens || 2048,
      temperature: config.temperature ?? 0.7,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`OpenRouter API error (${response.status}): ${errorData?.error?.message || response.statusText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

// --- Rate Limiter ---

const MAX_REQUESTS_PER_MINUTE = 20;
const RATE_LIMIT_RESET_INTERVAL = 60000;

const rateLimiter = (() => {
  let requestCount = 0;
  let lastResetTime = Date.now();
  const queue = [];

  const resetRateLimit = () => {
    const now = Date.now();
    if (now - lastResetTime > RATE_LIMIT_RESET_INTERVAL) {
      requestCount = 0;
      lastResetTime = now;
    }
  };

  const executeNext = () => {
    if (queue.length > 0) {
      resetRateLimit();
      if (requestCount < MAX_REQUESTS_PER_MINUTE) {
        const next = queue.shift();
        requestCount++;
        next.resolve(next.fn());
        if (queue.length > 0) {
          setTimeout(executeNext, RATE_LIMIT_RESET_INTERVAL / MAX_REQUESTS_PER_MINUTE);
        }
      } else {
        setTimeout(executeNext, RATE_LIMIT_RESET_INTERVAL - (Date.now() - lastResetTime));
      }
    }
  };

  return (fn) => {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      if (queue.length === 1) {
        executeNext();
      }
    });
  };
})();

const enhanceTextWithRateLimit = (promptId, text) => {
  return rateLimiter(() => enhanceTextWithLLM(promptId, text));
};

// --- Utilities ---

async function getConfig() {
  try {
    const config = await browserAPI.storage.sync.get(CONFIG_DEFAULTS);
    return {
      apiKey: config.apiKey || '',
      llmModel: config.llmModel || CONFIG_DEFAULTS.llmModel,
      customEndpoint: config.customEndpoint || '',
      llmProvider: config.llmProvider || CONFIG_DEFAULTS.llmProvider,
      customPrompts: config.customPrompts || [],
      systemInstruction: config.systemInstruction || DEFAULT_SYSTEM_INSTRUCTION,
      temperature: config.temperature ?? CONFIG_DEFAULTS.temperature,
      maxTokens: config.maxTokens ?? CONFIG_DEFAULTS.maxTokens,
    };
  } catch (error) {
    console.error('Error getting config:', error);
    return { ...CONFIG_DEFAULTS };
  }
}

async function fetchWithTimeout(url, options, timeout = 30000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timed out. The AI service took too long to respond.');
    }
    throw error;
  } finally {
    clearTimeout(id);
  }
}

function log(message, level = 'info') {
  const timestamp = new Date().toISOString();
  console[level](`[Scramble ${timestamp}] ${message}`);
}
