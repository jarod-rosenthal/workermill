import express from 'express';
import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware';
import * as fs from 'fs';

const app = express();
const USAGE_FILE = '/tmp/claude_usage.json';
const ANTHROPIC_API = 'https://api.anthropic.com';

// Initialize usage tracking
let totalUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
};

// Write initial empty usage file
fs.writeFileSync(USAGE_FILE, JSON.stringify(totalUsage));
console.log('[proxy] Anthropic proxy starting...');
console.log('[proxy] Usage file:', USAGE_FILE);

// Proxy all requests to Anthropic API
app.use('/v1/messages', createProxyMiddleware({
  target: ANTHROPIC_API,
  changeOrigin: true,
  selfHandleResponse: true,
  onProxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
    const contentType = proxyRes.headers['content-type'] || '';

    // Only process JSON responses (non-streaming)
    if (contentType.includes('application/json')) {
      try {
        const responseBody = responseBuffer.toString('utf8');
        const response = JSON.parse(responseBody);

        if (response.usage) {
          totalUsage.inputTokens += response.usage.input_tokens || 0;
          totalUsage.outputTokens += response.usage.output_tokens || 0;

          if (response.usage.cache_creation_input_tokens) {
            totalUsage.cacheCreationTokens += response.usage.cache_creation_input_tokens;
          }
          if (response.usage.cache_read_input_tokens) {
            totalUsage.cacheReadTokens += response.usage.cache_read_input_tokens;
          }

          // Write cumulative usage to file
          fs.writeFileSync(USAGE_FILE, JSON.stringify(totalUsage));
          console.log(`[proxy] Token usage captured: input=${response.usage.input_tokens}, output=${response.usage.output_tokens}`);
          console.log(`[proxy] Cumulative: ${JSON.stringify(totalUsage)}`);
        }
      } catch (e) {
        // JSON parse error, ignore
        console.log('[proxy] Could not parse response as JSON');
      }
    } else if (contentType.includes('text/event-stream')) {
      // Handle SSE streaming responses
      // Parse the response buffer for usage data in the final message
      const responseText = responseBuffer.toString('utf8');
      const lines = responseText.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));

            // Look for message_delta with usage (final event in stream)
            if (data.type === 'message_delta' && data.usage) {
              totalUsage.outputTokens += data.usage.output_tokens || 0;
              fs.writeFileSync(USAGE_FILE, JSON.stringify(totalUsage));
              console.log(`[proxy] Stream delta usage: output=${data.usage.output_tokens}`);
            }

            // Look for message_start with usage (input tokens)
            if (data.type === 'message_start' && data.message?.usage) {
              totalUsage.inputTokens += data.message.usage.input_tokens || 0;
              if (data.message.usage.cache_creation_input_tokens) {
                totalUsage.cacheCreationTokens += data.message.usage.cache_creation_input_tokens;
              }
              if (data.message.usage.cache_read_input_tokens) {
                totalUsage.cacheReadTokens += data.message.usage.cache_read_input_tokens;
              }
              fs.writeFileSync(USAGE_FILE, JSON.stringify(totalUsage));
              console.log(`[proxy] Stream start usage: input=${data.message.usage.input_tokens}`);
            }
          } catch (e) {
            // Not valid JSON, skip
          }
        }
      }
      console.log(`[proxy] Cumulative after stream: ${JSON.stringify(totalUsage)}`);
    }

    return responseBuffer;
  }),
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', usage: totalUsage });
});

// Usage endpoint for debugging
app.get('/usage', (req, res) => {
  res.json(totalUsage);
});

// Start proxy server
const PORT = process.env.PROXY_PORT || 8080;
app.listen(PORT, () => {
  console.log(`[proxy] Anthropic proxy listening on port ${PORT}`);
  console.log(`[proxy] Proxying requests to ${ANTHROPIC_API}`);
});
