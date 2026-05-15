#!/usr/bin/env node

const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

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
  const server = http.createServer(async (req, res) => {
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

        const stream = parsed.stream === true;
        if (stream) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.write('data: {"id":"chatcmpl-stream","object":"chat.completion.chunk","model":"mimo-upstream","choices":[{"index":0,"delta":{"content":"hello"}}]}\n\n');
          setTimeout(() => {
            res.write('data: {"id":"chatcmpl-stream","object":"chat.completion.chunk","model":"mimo-upstream","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":6,"prompt_tokens_details":{"cached_tokens":2}}}\n\n');
            res.write('data: [DONE]\n\n');
            res.end();
          }, 80);
          return;
        }

        const response = {
          id: 'chatcmpl-nonstream',
          object: 'chat.completion',
          model: 'mimo-upstream',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: { role: 'assistant', content: 'ok' },
            },
          ],
          usage: {
            prompt_tokens: 20,
            completion_tokens: 10,
            prompt_tokens_details: {
              cached_tokens: 4,
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
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function startProxy(port, monitorStorage, sqlitePath, configDir) {
  const child = spawn(process.execPath, ['dist/index.js'], {
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      LOG_LEVEL: 'error',
      MIMO_API_KEY: 'dummy-key',
      PROXY_API_KEY: 'proxy-test-key',
      CONFIG_DIR: configDir,
      MONITOR_STORAGE: monitorStorage,
      MONITOR_SQLITE_PATH: sqlitePath || './data/test-monitor.db',
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
    }, 12000);

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

async function run() {
  const sqlitePath = path.resolve('data/monitor-e2e.db');
  if (fs.existsSync(sqlitePath)) {
    fs.unlinkSync(sqlitePath);
  }

  // Create temporary provider config
  const configDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'chimera-monitor-'));
  const configFile = path.join(configDir, 'mimo.yaml');
  const yamlContent = `version: 1
type: mimo
name: test-mimo
api_key: dummy-key
base_url: http://127.0.0.1:18080
auth_header: api-key
auth_prefix: ""
capabilities:
  thinking: true
  web_search: true
  json_output: true
models:
  - id: mimo-v2-flash
    upstream: mimo-v2-flash
    context_length: 256000
    max_output_tokens: 64000
  - id: mimo-v2-flash-thinking
    upstream: mimo-v2-flash
    context_length: 256000
    max_output_tokens: 64000
    default:
      thinking:
        type: enabled
`;
  fs.writeFileSync(configFile, yamlContent);

  console.log('Starting mock upstream...');
  const mockServer = await startMockUpstream(18080);

  try {
    console.log('\n[1/2] Memory mode smoke test');
    const proxyPort1 = 19090;
    const proxy1 = startProxy(proxyPort1, 'memory', sqlitePath, configDir);
    try {
      await waitForHttp(`http://127.0.0.1:${proxyPort1}/health`);

      const health = await jsonFetch(`http://127.0.0.1:${proxyPort1}/health`);
      assert(health.status === 200, 'health should be 200');

      const models = await jsonFetch(`http://127.0.0.1:${proxyPort1}/v1/models`, {
        headers: { Authorization: 'Bearer proxy-test-key' },
      });
      assert(models.status === 200, '/v1/models should be 200');

      const nonStream = await jsonFetch(`http://127.0.0.1:${proxyPort1}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer proxy-test-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'mimo-v2-flash',
          messages: [{ role: 'user', content: 'hello' }],
        }),
      });
      assert(nonStream.status === 200, 'non-stream chat should be 200');
      assert(nonStream.body && nonStream.body.model === 'mimo-v2-flash', 'response model should be virtual model id');

      const streamRes = await fetch(`http://127.0.0.1:${proxyPort1}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer proxy-test-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'mimo-v2-flash',
          stream: true,
          messages: [{ role: 'user', content: 'stream' }],
        }),
      });
      assert(streamRes.status === 200, 'stream chat should be 200');
      const streamText = await streamRes.text();
      assert(streamText.includes('data: [DONE]'), 'stream response should include [DONE]');

      await sleep(300);
      const calls = await jsonFetch(`http://127.0.0.1:${proxyPort1}/monitor/calls?days=3&limit=50`);
      assert(calls.status === 200, '/monitor/calls should be 200');
      assert(Array.isArray(calls.body?.data), 'calls data should be array');
      assert(calls.body.data.length >= 2, 'calls should contain at least 2 records');

      const streamCall = calls.body.data.find((c) => c.stream === true);
      assert(streamCall, 'should have stream call record');
      assert(streamCall.first_token_ms === null || streamCall.first_token_ms >= 0, 'first_token_ms should be null or >=0');

      console.log('Memory mode smoke test passed.');
    } finally {
      await stopProxy(proxy1);
    }

    console.log('\n[2/2] SQLite persistence test');
    const proxyPort2 = 19091;
    const proxy2 = startProxy(proxyPort2, 'sqlite', sqlitePath, configDir);
    try {
      await waitForHttp(`http://127.0.0.1:${proxyPort2}/health`);

      const chat = await jsonFetch(`http://127.0.0.1:${proxyPort2}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer proxy-test-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'mimo-v2-flash-thinking',
          messages: [{ role: 'user', content: 'persist me' }],
        }),
      });
      assert(chat.status === 200, 'sqlite mode chat should be 200');

      await sleep(300);
      const callsBefore = await jsonFetch(`http://127.0.0.1:${proxyPort2}/monitor/calls?days=3&limit=50`);
      assert(callsBefore.status === 200, 'sqlite calls should be 200');
      assert(callsBefore.body.data.length >= 1, 'sqlite calls before restart should be >=1');
    } finally {
      await stopProxy(proxy2);
    }

    const proxy3 = startProxy(proxyPort2, 'sqlite', sqlitePath, configDir);
    try {
      await waitForHttp(`http://127.0.0.1:${proxyPort2}/health`);
      await sleep(200);
      const callsAfter = await jsonFetch(`http://127.0.0.1:${proxyPort2}/monitor/calls?days=3&limit=50`);
      assert(callsAfter.status === 200, 'sqlite calls after restart should be 200');
      assert(callsAfter.body.data.length >= 1, 'sqlite data should persist after restart');
      console.log('SQLite persistence test passed.');
    } finally {
      await stopProxy(proxy3);
    }

    console.log('\nAll monitor checks passed.');
  } finally {
    await new Promise((resolve) => mockServer.close(resolve));
    try { fs.rmSync(configDir, { recursive: true, force: true }); } catch {}
  }
}

run().catch((err) => {
  console.error('Monitor checks failed:', err);
  process.exit(1);
});
