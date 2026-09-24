// A local stand-in for the Messages API that behaves like claude-opus-5-5:
// it rejects what Opus 5.5 rejects (same status, same error shape) and answers
// everything else with thinking-first mock responses. No API key, no cost.

import http from 'node:http';
import crypto from 'node:crypto';
import { validateRequest } from '../rules/opus-5-5.js';
import { buildMessage, toSSE, checkPreservedThinking, newState } from './mock.js';

const errorBody = (type, message, requestId) => JSON.stringify({ type: 'error', error: { type, message }, request_id: requestId });

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * @param {{lenient?: boolean, simulateTools?: boolean, onRequest?: (rec: object) => void}} opts
 */
export function createProbeServer(opts = {}) {
  const state = newState();
  const records = [];

  const server = http.createServer(async (req, res) => {
    const requestId = `req_mb_${crypto.randomBytes(10).toString('hex')}`;
    const url = new URL(req.url, 'http://probe.local');
    const p = url.pathname.replace(/\/+$/, '');
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'content-type': type, 'request-id': requestId, 'x-model-bump': 'probe' });
      res.end(body);
    };

    if (req.method === 'GET' && /\/models$/.test(p)) {
      return send(200, JSON.stringify({ data: [{ type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-09-22T00:00:00Z' }], has_more: false, first_id: 'claude-opus-5-5', last_id: 'claude-opus-5-5' }));
    }
    const isCount = /\/messages\/count_tokens$/.test(p);
    const isMessages = /\/messages$/.test(p);
    if (req.method !== 'POST' || (!isCount && !isMessages)) {
      return send(404, errorBody('not_found_error', `model-bump probe only emulates POST /v1/messages and /v1/messages/count_tokens (got ${req.method} ${url.pathname})`, requestId));
    }

    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return send(400, errorBody('invalid_request_error', 'Request body is not valid JSON.', requestId));
    }

    const betas = [req.headers['anthropic-beta']].flat().filter(Boolean);
    const findings = [
      ...validateRequest(body, { betas, endpoint: isCount ? 'count_tokens' : 'messages' }),
      ...(isMessages ? checkPreservedThinking(body, state) : []),
    ];
    const firstError = findings.find((f) => f.severity === 'error');
    const rejected = Boolean(firstError) && !opts.lenient;
    const rec = {
      n: records.length + 1,
      endpoint: isCount ? 'count_tokens' : 'messages',
      model: body.model,
      stream: body.stream === true,
      tools: Array.isArray(body.tools) ? body.tools.length : 0,
      findings,
      status: rejected ? 400 : 200,
      userAgent: req.headers['user-agent'] || '',
      body,
    };
    records.push(rec);
    if (opts.onRequest) opts.onRequest(rec);

    if (rejected) return send(400, errorBody('invalid_request_error', firstError.apiMessage || firstError.title, requestId));
    if (isCount) return send(200, JSON.stringify({ input_tokens: Math.max(1, Math.ceil(JSON.stringify(body.messages || []).length / 4)) }));

    const message = buildMessage(body, opts, state);
    if (body.stream === true) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'request-id': requestId, 'x-model-bump': 'probe' });
      return res.end(toSSE(message));
    }
    return send(200, JSON.stringify(message));
  });

  return { server, records, state };
}

export function listen(server, port = 0, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server.address()));
  });
}
