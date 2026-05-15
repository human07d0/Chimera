#!/usr/bin/env node

/**
 * Automated test script for virtual models
 * Uses mock upstream server - no real API calls or token consumption
 */

const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Configuration
const MOCK_UPSTREAM_PORT = 18081;
const PROXY_PORT = 19092;

// Base model for virtual model generation
const BASE_MODEL = 'mimo-v2-flash';

// Feature combinations to test (2^3 = 8)
const FEATURE_COMBINATIONS = [
  { suffix: '', features: { thinking: false, search: false, json: false } },
  { suffix: '-thinking', features: { thinking: true, search: false, json: false } },
  { suffix: '-search', features: { thinking: false, search: true, json: false } },
  { suffix: '-json', features: { thinking: false, search: false, json: true } },
  { suffix: '-thinking-search', features: { thinking: true, search: true, json: false } },
  { suffix: '-thinking-json', features: { thinking: true, search: false, json: true } },
  { suffix: '-search-json', features: { thinking: false, search: true, json: true } },
  { suffix: '-thinking-search-json', features: { thinking: true, search: true, json: true } },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error(`Timeout waiting for ${url}`);
}

function startMockUpstream(port) {
  const receivedRequests = [];

  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString('utf8');
      });
      req.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(body || '{}');
        } catch {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: { message: 'invalid json', type: 'invalid_request_error' } }));
          return;
        }

        // Record the request for later verification
        receivedRequests.push(parsed);

        const model = parsed.model || '';
        const hasThinking = parsed.thinking && parsed.thinking.type === 'enabled';
        const hasWebSearch = parsed.tools && parsed.tools.some((t) => t.type === 'web_search');
        const hasJsonFormat = parsed.response_format && parsed.response_format.type === 'json_object';

        // Keep these derived flags to ensure mock behavior follows forwarded params
        void hasWebSearch;
        void hasJsonFormat;

        const thinkingContent = hasThinking ? ' [thinking] Analyzing... [/thinking] ' : '';

        const stream = parsed.stream === true;
        if (stream) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');

          const content = `Hello from ${model}${thinkingContent}Test response.`;
          res.write(`data: {"id":"chatcmpl-${Date.now()}","object":"chat.completion.chunk","model":"${model}","choices":[{"index":0,"delta":{"content":"${content}"}}]}\n\n`);

          if (hasThinking) {
            res.write(`data: {"id":"chatcmpl-${Date.now()}","object":"chat.completion.chunk","model":"${model}","choices":[{"index":0,"delta":{"reasoning_content":"Thinking process..."}}]}\n\n`);
          }

          setTimeout(() => {
            res.write(`data: {"id":"chatcmpl-${Date.now()}","object":"chat.completion.chunk","model":"${model}","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":3,"prompt_tokens_details":{"cached_tokens":0}}}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
          }, 20);
          return;
        }

        const response = {
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion',
          model,
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: `Hello from ${model}${thinkingContent}Test response.`,
                ...(hasThinking ? { reasoning_content: 'Thinking process...' } : {}),
              },
            },
          ],
          usage: {
            prompt_tokens: 5,
            completion_tokens: 3,
            prompt_tokens_details: {
              cached_tokens: 0,
            },
          },
        };

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(response));
      });
      return;
    }

    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'not found' }));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, receivedRequests }));
  });
}

function startProxy(port, configDir) {
  const child = spawn(process.execPath, ['dist/index.js'], {
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      LOG_LEVEL: 'error',
      MIMO_API_KEY: 'dummy-key',
      PROXY_API_KEY: 'proxy-test-key',
      CONFIG_DIR: configDir,
      MONITOR_STORAGE: 'memory',
      MONITOR_FLUSH_INTERVAL_MS: '100',
      MONITOR_FLUSH_BATCH_SIZE: '1',
      MONITOR_QUEUE_MAX_SIZE: '1000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (d) => process.stdout.write(`[proxy:${port}] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[proxy:${port}:err] ${d}`));

  return child;
}

async function stopProxy(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
      resolve();
    }, 5000);

    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function jsonFetch(url, init = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function generateModelId(suffix) {
  return suffix ? `${BASE_MODEL}${suffix}` : BASE_MODEL;
}

async function testModel(proxyUrl, modelId, testType = 'non-stream') {
  const isStream = testType === 'stream';

  const requestBody = {
    model: modelId,
    messages: [{ role: 'user', content: 'Test' }],
    ...(isStream ? { stream: true } : {}),
  };

  const res = await fetch(`${proxyUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer proxy-test-key',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (isStream) {
    const text = await res.text();
    return { status: res.status, body: text };
  }

  const body = await res.json();
  return { status: res.status, body };
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('Chimera - Virtual Models Test Suite');
  console.log('='.repeat(60));
  console.log(`Model: ${BASE_MODEL}`);
  console.log(`Combinations: ${FEATURE_COMBINATIONS.length}`);
  console.log();

  // Create temporary provider config
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chimera-test-'));
  const configFile = path.join(configDir, 'mimo.yaml');
  const yamlContent = `version: 1
type: mimo
name: test-mimo
api_key: dummy-key
base_url: http://127.0.0.1:${MOCK_UPSTREAM_PORT}
auth_header: api-key
auth_prefix: ""
capabilities:
  thinking: true
  web_search: true
  json_output: true
web_search:
  max_keyword: 3
  force_search: false
  limit: 5
  user_location:
    country: CN
    region: ""
    city: ""
models:
  - id: mimo-v2-flash
    upstream: mimo-v2-flash
    context_length: 256000
    max_output_tokens: 64000
    default:
      thinking:
        type: disabled
  - id: mimo-v2-flash-thinking
    upstream: mimo-v2-flash
    context_length: 256000
    max_output_tokens: 64000
    default:
      thinking:
        type: enabled
  - id: mimo-v2-flash-search
    upstream: mimo-v2-flash
    context_length: 256000
    max_output_tokens: 64000
    default:
      thinking:
        type: disabled
      web_search: true
  - id: mimo-v2-flash-json
    upstream: mimo-v2-flash
    context_length: 256000
    max_output_tokens: 64000
    default:
      thinking:
        type: disabled
      response_format:
        type: json_object
  - id: mimo-v2-flash-thinking-search
    upstream: mimo-v2-flash
    context_length: 256000
    max_output_tokens: 64000
    default:
      thinking:
        type: enabled
      web_search: true
  - id: mimo-v2-flash-thinking-json
    upstream: mimo-v2-flash
    context_length: 256000
    max_output_tokens: 64000
    default:
      thinking:
        type: enabled
      response_format:
        type: json_object
  - id: mimo-v2-flash-search-json
    upstream: mimo-v2-flash
    context_length: 256000
    max_output_tokens: 64000
    default:
      thinking:
        type: disabled
      web_search: true
      response_format:
        type: json_object
  - id: mimo-v2-flash-thinking-search-json
    upstream: mimo-v2-flash
    context_length: 256000
    max_output_tokens: 64000
    default:
      thinking:
        type: enabled
      web_search: true
      response_format:
        type: json_object
`;
  fs.writeFileSync(configFile, yamlContent);

  // Start mock upstream server
  console.log(`Starting mock upstream on port ${MOCK_UPSTREAM_PORT}...`);
  const { server: mockServer, receivedRequests } = await startMockUpstream(MOCK_UPSTREAM_PORT);
  console.log('Mock upstream started.\n');

  let proxy;
  let testsPassed = 0;
  let testsFailed = 0;
  const failedTests = [];
  let exitCode = 0;

  try {
    // Start proxy
    console.log(`Starting proxy on port ${PROXY_PORT}...`);
    proxy = startProxy(PROXY_PORT, configDir);
    await waitForHttp(`http://127.0.0.1:${PROXY_PORT}/health`, 10000);
    console.log('Proxy started.\n');

    const proxyUrl = `http://127.0.0.1:${PROXY_PORT}`;

    // ========== Test 1: Models list ==========
    console.log('[Test 1] Virtual models list');
    const modelsRes = await jsonFetch(`${proxyUrl}/v1/models`, {
      headers: { Authorization: 'Bearer proxy-test-key' },
    });

    assert(modelsRes.status === 200, `Expected 200, got ${modelsRes.status}`);
    assert(Array.isArray(modelsRes.body.data), 'Response should have data array');

    const virtualModels = modelsRes.body.data;
    const expectedCount = FEATURE_COMBINATIONS.length;
    assert(
      virtualModels.length === expectedCount,
      `Expected ${expectedCount} models, got ${virtualModels.length}`
    );
    console.log(`  ✓ Returns ${expectedCount} virtual models\n`);
    testsPassed++;

    // ========== Test 2: Feature injection ==========
    console.log('[Test 2] Feature injection verification');

    for (const combo of FEATURE_COMBINATIONS) {
      const modelId = generateModelId(combo.suffix);
      const testId = combo.suffix || 'base';

      try {
        receivedRequests.length = 0; // Clear previous requests

        const result = await testModel(proxyUrl, modelId, 'non-stream');
        assert(result.status === 200, `Status ${result.status}`);
        assert(result.body.model === modelId, `Model mismatch: ${result.body.model}`);

        // Verify the upstream received the correct parameters
        assert(receivedRequests.length > 0, 'Mock did not receive request');
        const upstreamReq = receivedRequests[0];

        // Verify virtual model is mapped to base model upstream
        assert(
          upstreamReq.model === BASE_MODEL,
          `Upstream model should be ${BASE_MODEL}, got ${upstreamReq.model}`
        );

        // Check thinking feature
        if (combo.features.thinking) {
          assert(
            upstreamReq.thinking && upstreamReq.thinking.type === 'enabled',
            `Missing thinking parameter for ${testId}`
          );
          assert(
            result.body.choices[0].message.reasoning_content,
            `Missing reasoning_content in response for ${testId}`
          );
        } else {
          assert(
            upstreamReq.thinking && upstreamReq.thinking.type === 'disabled',
            `Thinking should be explicitly disabled for ${testId}`
          );
        }

        // Check search feature
        if (combo.features.search) {
          assert(
            upstreamReq.tools && upstreamReq.tools.some((t) => t.type === 'web_search'),
            `Missing web_search tool for ${testId}`
          );
        } else {
          assert(
            !upstreamReq.tools || !upstreamReq.tools.some((t) => t.type === 'web_search'),
            `Unexpected web_search tool for ${testId}`
          );
        }

        // Check json feature
        if (combo.features.json) {
          assert(
            upstreamReq.response_format && upstreamReq.response_format.type === 'json_object',
            `Missing json_object format for ${testId}`
          );
        } else {
          assert(!upstreamReq.response_format, `Unexpected response_format for ${testId}`);
        }

        console.log(`  ✓ ${testId} - features injected correctly`);
        testsPassed++;
      } catch (err) {
        console.log(`  ✗ ${testId}: ${err.message}`);
        testsFailed++;
        failedTests.push({ test: testId, error: err.message });
      }
    }
    console.log();

    // ========== Test 3: Streaming ==========
    console.log('[Test 3] Streaming support');

    for (const combo of FEATURE_COMBINATIONS) {
      const modelId = generateModelId(combo.suffix);
      const testId = combo.suffix || 'base';

      try {
        const result = await testModel(proxyUrl, modelId, 'stream');
        assert(result.status === 200, `Status ${result.status}`);
        assert(result.body.includes('data: [DONE]'), 'Missing [DONE] marker');
        assert(result.body.includes('data: {'), 'Missing data chunks');

        console.log(`  ✓ ${testId} streaming works`);
        testsPassed++;
      } catch (err) {
        console.log(`  ✗ ${testId}: ${err.message}`);
        testsFailed++;
        failedTests.push({ test: `${testId} (stream)`, error: err.message });
      }
    }
    console.log();

    // ========== Test 4: Error handling ==========
    console.log('[Test 4] Error handling');

    // Invalid model
    try {
      const res = await testModel(proxyUrl, 'invalid-model-xyz', 'non-stream');
      assert(res.status === 404, `Expected 404, got ${res.status}`);
      console.log('  ✓ Invalid model returns 404');
      testsPassed++;
    } catch (err) {
      console.log(`  ✗ Invalid model: ${err.message}`);
      testsFailed++;
      failedTests.push({ test: 'invalid-model', error: err.message });
    }

    // Missing auth
    try {
      const res = await fetch(`${proxyUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: BASE_MODEL, messages: [{ role: 'user', content: 'test' }] }),
      });
      assert(res.status === 401, `Expected 401, got ${res.status}`);
      console.log('  ✓ Missing auth returns 401');
      testsPassed++;
    } catch (err) {
      console.log(`  ✗ Missing auth: ${err.message}`);
      testsFailed++;
      failedTests.push({ test: 'missing-auth', error: err.message });
    }

    // Wrong auth
    try {
      const res = await fetch(`${proxyUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer wrong-key',
        },
        body: JSON.stringify({ model: BASE_MODEL, messages: [{ role: 'user', content: 'test' }] }),
      });
      assert(res.status === 401, `Expected 401, got ${res.status}`);
      console.log('  ✓ Wrong auth returns 401');
      testsPassed++;
    } catch (err) {
      console.log(`  ✗ Wrong auth: ${err.message}`);
      testsFailed++;
      failedTests.push({ test: 'wrong-auth', error: err.message });
    }
    console.log();

    // ========== Test 5: Health check ==========
    console.log('[Test 5] Health check');
    try {
      const res = await fetch(`http://127.0.0.1:${PROXY_PORT}/health`);
      assert(res.ok, 'Health check failed');
      console.log('  ✓ Health check OK');
      testsPassed++;
    } catch (err) {
      console.log(`  ✗ Health: ${err.message}`);
      testsFailed++;
      failedTests.push({ test: 'health', error: err.message });
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total:  ${testsPassed + testsFailed}`);
    console.log(`Passed: ${testsPassed}`);
    console.log(`Failed: ${testsFailed}`);

    if (failedTests.length > 0) {
      console.log('\nFailed:');
      failedTests.forEach(({ test, error }) => {
        console.log(`  - ${test}: ${error}`);
      });
    }

    console.log('='.repeat(60));

    if (testsFailed > 0) {
      console.log('\n❌ Some tests failed!');
      exitCode = 1;
    } else {
      console.log('\n✅ All tests passed!');
      exitCode = 0;
    }
  } finally {
    if (proxy) await stopProxy(proxy);
    await new Promise((resolve) => mockServer.close(resolve));
    try { fs.rmSync(configDir, { recursive: true, force: true }); } catch {}
  }

  return exitCode;
}

process.on('uncaughtException', (err) => {
  console.error('Uncaught:', err);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled:', err);
  process.exit(1);
});

runTests()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  });


