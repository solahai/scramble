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

const DEFAULT_SYSTEM_INSTRUCTION = 'You are a helpful writing assistant. You enhance, correct, and improve text while preserving the author\'s voice and intent. IMPORTANT: Preserve the original paragraph structure and line breaks exactly as they appear. Do not merge paragraphs or remove line breaks. Always return only the processed text without any additional commentary, quotes, or explanation.';

const CONFIG_DEFAULTS = {
  apiKey: '',
  llmProvider: 'openai',
  llmModel: 'gpt-5.2',
  customEndpoint: '',
  customPrompts: [],
  systemInstruction: DEFAULT_SYSTEM_INSTRUCTION,
  temperature: 0.7,
  maxTokens: 2048,
  showPreview: true,
};

const activeRequests = new Map();
let contextMenuUpdateChain = Promise.resolve();

// --- Installation & Setup ---

if (typeof importScripts === 'function') {
  browserAPI.runtime.onInstalled.addListener(handleInstall);
  browserAPI.runtime.onStartup?.addListener(() => {
    updateContextMenu();
  });
} else {
  handleInstall({ reason: 'install' });
}

async function handleInstall(details) {
  if (details.reason === 'install') {
    log('Scramble installed. Welcome!');
    const existing = await getConfig();
    if (!existing.apiKey) {
      await browserAPI.storage.sync.set({ ...CONFIG_DEFAULTS, onboardingComplete: false });
    }
    if (browserAPI.runtime.openOptionsPage) {
      browserAPI.runtime.openOptionsPage();
    }
  } else if (details.reason === 'update') {
    log(`Extension updated to v${browserAPI.runtime.getManifest().version}`);
  }
  await updateContextMenu();
}

// --- Context Menu ---

function promisifyChrome(fn) {
  return new Promise((resolve, reject) => {
    try {
      fn((result) => {
        const err = browserAPI.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(result);
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function runContextMenuApi(method, ...args) {
  const apiFn = browserAPI.contextMenus[method];
  if (!apiFn) throw new Error(`contextMenus.${method} is not available`);

  try {
    const result = apiFn.call(browserAPI.contextMenus, ...args);
    if (result && typeof result.then === 'function') {
      await result;
      return;
    }
  } catch (error) {
    throw error;
  }

  await promisifyChrome((done) => apiFn.call(browserAPI.contextMenus, ...args, done));
}

function removeAllContextMenus() {
  return runContextMenuApi('removeAll');
}

async function createContextMenuItem(item) {
  try {
    await runContextMenuApi('create', item);
  } catch (error) {
    if (/duplicate id/i.test(error.message)) {
      const { id, parentId, title, contexts } = item;
      await runContextMenuApi('update', id, { title, contexts, parentId });
      return;
    }
    throw error;
  }
}

async function updateContextMenuInternal() {
  await removeAllContextMenus();

  const config = await getConfig();
  const defaultIds = new Set(DEFAULT_PROMPTS.map(p => p.id));
  const customPrompts = (config.customPrompts || []).filter(
    p => p?.id && p?.title && p?.prompt && !defaultIds.has(p.id)
  );
  const allPrompts = [...DEFAULT_PROMPTS, ...customPrompts];

  await createContextMenuItem({
    id: 'scramble',
    title: 'Scramble',
    contexts: ['selection'],
  });

  for (const prompt of allPrompts) {
    await createContextMenuItem({
      id: prompt.id,
      parentId: 'scramble',
      title: prompt.title,
      contexts: ['selection'],
    });
  }
}

function updateContextMenu() {
  contextMenuUpdateChain = contextMenuUpdateChain
    .then(() => updateContextMenuInternal())
    .catch((error) => {
      console.error('Error updating context menu:', error);
    });
  return contextMenuUpdateChain;
}

browserAPI.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.customPrompts) {
    updateContextMenu();
  }
});

// --- Content Script Injection ---

async function ensureContentScript(tabId) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await browserAPI.tabs.sendMessage(tabId, { action: 'ping' });
      return;
    } catch {
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 150));
        continue;
      }
    }
  }

  await injectContentScript(tabId);
  await new Promise(r => setTimeout(r, 100));

  await browserAPI.tabs.sendMessage(tabId, { action: 'ping' });
}

async function injectContentScript(tabId) {
  try {
    if (chrome.scripting?.executeScript) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      });
      return;
    }

    if (typeof browser !== 'undefined' && browser.tabs?.executeScript) {
      await browser.tabs.executeScript(tabId, { file: 'content.js' });
      return;
    }

    throw new Error('No supported script injection API available in this browser.');
  } catch (error) {
    console.error('Failed to inject content script:', error);
    throw error;
  }
}

// Build context menus when the service worker starts (covers extension reload).
updateContextMenu();

// --- Context Menu Click Handler ---

browserAPI.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id || !info.selectionText?.trim()) return;

  browserAPI.storage.sync.get('customPrompts', async ({ customPrompts = [] }) => {
    const allPrompts = [...DEFAULT_PROMPTS, ...customPrompts];
    if (allPrompts.some(prompt => prompt.id === info.menuItemId)) {
      try {
        await ensureContentScript(tab.id);
        await sendEnhanceTextMessage(tab.id, info.menuItemId, info.selectionText);
      } catch (error) {
        console.error('Error handling context menu click:', error);
        notifyTab(tab.id, friendlyError(error.message), 'error');
      }
    }
  });
});

function notifyTab(tabId, message, type = 'info') {
  if (!tabId) return;
  browserAPI.tabs.sendMessage(tabId, { action: 'showToast', message, type }).catch(() => {});
}

function friendlyError(msg) {
  if (!msg) return 'Something went wrong. Open Scramble Settings to check your configuration.';
  if (/401|403|Incorrect API key|invalid.*key|authentication/i.test(msg)) {
    return 'Invalid API key. Open Scramble Settings to update your key.';
  }
  if (/timed out|timeout/i.test(msg)) return 'Request timed out. Try again or check your connection.';
  if (/429|rate limit/i.test(msg)) return 'Rate limit reached. Please wait a moment and try again.';
  return msg;
}

async function sendEnhanceTextMessage(tabId, promptId, selectedText) {
  const response = await browserAPI.tabs.sendMessage(tabId, {
    action: 'enhanceText',
    promptId,
    selectedText,
  });
  if (response && !response.success) {
    notifyTab(tabId, friendlyError(response.error), 'error');
  }
  return response;
}

// --- Message Handler ---

browserAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'enhanceText') {
    const requestId = request.requestId || `req_${Date.now()}`;
    const controller = new AbortController();
    activeRequests.set(requestId, controller);

    const tabId = sender.tab?.id;
    const onQueued = (position) => {
      if (tabId && position > 1) {
        browserAPI.tabs.sendMessage(tabId, { action: 'queueStatus', position }).catch(() => {});
      }
    };

    enhanceTextWithRateLimit(request.promptId, request.selectedText, controller.signal, onQueued)
      .then(enhancedText => {
        activeRequests.delete(requestId);
        sendResponse({ success: true, enhancedText });
      })
      .catch(error => {
        activeRequests.delete(requestId);
        const message = controller.signal.aborted ? 'Cancelled' : error.message;
        log(`Error enhancing text: ${message}`, 'error');
        sendResponse({ success: false, error: message });
      });
    return true;
  }

  if (request.action === 'cancelEnhancement') {
    const controller = activeRequests.get(request.requestId);
    if (controller) {
      controller.abort();
      activeRequests.delete(request.requestId);
    }
    sendResponse({ success: true });
    return;
  }

  if (request.action === 'testConnection') {
    testConnection(request.config)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
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
    const [tab] = await browserAPI.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    try {
      await ensureContentScript(tab.id);
    } catch (error) {
      console.error('Failed to prepare content script for shortcut:', error);
      return;
    }

    if (command === 'fix-grammar') {
      await browserAPI.tabs.sendMessage(tab.id, {
        action: 'triggerFromShortcut',
        promptId: 'fix_grammar'
      });
    } else if (command === 'improve-writing') {
      await browserAPI.tabs.sendMessage(tab.id, {
        action: 'triggerFromShortcut',
        promptId: 'improve_writing'
      });
    } else if (command === 'open-toolbar') {
      await browserAPI.tabs.sendMessage(tab.id, { action: 'showToolbar' });
    }
  });
}

// --- LLM Enhancement ---

async function enhanceTextWithLLM(promptId, text, signal = null, overrideConfig = null) {
  const config = overrideConfig || await getConfig();
  if (signal?.aborted) throw new Error('Cancelled');

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

  return await enhanceFunction(fullPrompt, systemInstruction, config, signal);
}

// --- Provider Implementations ---

async function enhanceWithOpenAI(prompt, systemInstruction, config, signal = null) {
  if (!config.apiKey) {
    throw new Error('OpenAI API key not set. Please configure it in Scramble settings.');
  }

  const model = config.llmModel || 'gpt-5.2';
  const customEndpoint = config.customEndpoint || '';

  // If user set a custom endpoint, use Chat Completions format against that endpoint
  if (customEndpoint) {
    return await openaiChatCompletions(prompt, systemInstruction, config, model, customEndpoint, signal);
  }

  try {
    return await openaiResponsesAPI(prompt, systemInstruction, config, model, signal);
  } catch (error) {
    if (/404|not found|does not exist|unsupported|invalid.*model|responses/i.test(error.message)) {
      return await openaiChatCompletions(
        prompt,
        systemInstruction,
        config,
        model,
        'https://api.openai.com/v1/chat/completions',
        signal
      );
    }
    throw error;
  }
}

async function openaiResponsesAPI(prompt, systemInstruction, config, model, signal = null) {
  const endpoint = 'https://api.openai.com/v1/responses';

  const body = {
    model: model,
    instructions: systemInstruction,
    input: prompt,
    max_output_tokens: config.maxTokens || 2048,
  };

  // gpt-5 (base, not 5.2+) does not support temperature — all others do
  const isGPT5Base = /^gpt-5$/i.test(model) || /^gpt-5-\d/i.test(model);
  if (!isGPT5Base) {
    const temp = config.temperature ?? 0.7;
    if (temp !== 1) {
      body.temperature = temp;
    }
  }

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  }, 30000, signal);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`OpenAI API error (${response.status}): ${errorData?.error?.message || response.statusText}`);
  }

  const data = await response.json();

  // Responses API: output[] → message → content[] → output_text
  if (data.output && Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item.type === 'message' && item.content) {
        for (const content of item.content) {
          if (content.type === 'output_text' || content.type === 'text') {
            return content.text.trim();
          }
        }
      }
    }
  }

  throw new Error('Unexpected response format from OpenAI API.');
}

async function openaiChatCompletions(prompt, systemInstruction, config, model, endpoint, signal = null) {
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: prompt }
      ],
      max_tokens: config.maxTokens || 2048,
      temperature: config.temperature ?? 0.7,
    }),
  }, 30000, signal);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`OpenAI API error (${response.status}): ${errorData?.error?.message || response.statusText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Unexpected response format from OpenAI API.');
  }
  return content.trim();
}

async function enhanceWithAnthropic(prompt, systemInstruction, config, signal = null) {
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
  }, 30000, signal);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Anthropic API error (${response.status}): ${errorData?.error?.message || response.statusText}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text;
  if (!text) {
    throw new Error('Unexpected response format from Anthropic API.');
  }
  return text.trim();
}

async function enhanceWithOllama(prompt, systemInstruction, config, signal = null) {
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
  }, 30000, signal);

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

async function enhanceWithLMStudio(prompt, systemInstruction, config, signal = null) {
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
  }, 30000, signal);

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

async function enhanceWithGroq(prompt, systemInstruction, config, signal = null) {
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
  }, 30000, signal);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Groq API error (${response.status}): ${errorData?.error?.message || response.statusText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Unexpected response format from Groq API.');
  }
  return content.trim();
}

async function enhanceWithOpenRouter(prompt, systemInstruction, config, signal = null) {
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
      'HTTP-Referer': 'https://github.com/solahai/scramble',
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
  }, 30000, signal);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`OpenRouter API error (${response.status}): ${errorData?.error?.message || response.statusText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Unexpected response format from OpenRouter API.');
  }
  return content.trim();
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
        Promise.resolve(next.fn()).then(next.resolve).catch(next.reject);
        if (queue.length > 0) {
          setTimeout(executeNext, RATE_LIMIT_RESET_INTERVAL / MAX_REQUESTS_PER_MINUTE);
        }
      } else {
        setTimeout(executeNext, RATE_LIMIT_RESET_INTERVAL - (Date.now() - lastResetTime));
      }
    }
  };

  return (fn, onQueued) => {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      if (onQueued && queue.length > 1) {
        onQueued(queue.length);
      }
      if (queue.length === 1) {
        executeNext();
      }
    });
  };
})();

const enhanceTextWithRateLimit = (promptId, text, signal, onQueued) => {
  return rateLimiter(() => {
    if (signal?.aborted) {
      return Promise.reject(new Error('Cancelled'));
    }
    return enhanceTextWithLLM(promptId, text, signal);
  }, onQueued);
};

async function testConnection(config) {
  const testConfig = { ...(await getConfig()), ...config };
  const result = await enhanceTextWithLLM('fix_grammar', 'Hello world', null, testConfig);
  if (!result || !result.trim()) {
    throw new Error('Connection test returned an empty response.');
  }
  return { message: 'Connection successful!', sample: result.trim().slice(0, 80) };
}

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
      showPreview: config.showPreview !== false,
    };
  } catch (error) {
    console.error('Error getting config:', error);
    return { ...CONFIG_DEFAULTS };
  }
}

async function fetchWithTimeout(url, options, timeout = 30000, externalSignal = null) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(id);
      throw new Error('Cancelled');
    }
    externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(externalSignal?.aborted ? 'Cancelled' : 'Request timed out. The AI service took too long to respond.');
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
