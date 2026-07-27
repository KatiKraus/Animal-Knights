const https = require("https");
const http  = require("http");

const API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT    = process.env.PORT || 3000;

function callAnthropic(messages, maxTokens) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:      "claude-sonnet-4-6",
      max_tokens: maxTokens,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages:   messages
    });

    const req = https.request({
      hostname: "api.anthropic.com",
      path:     "/v1/messages",
      method:   "POST",
      timeout:  120000,
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta":    "web-search-2025-03-05",
        "Content-Length":    Buffer.byteLength(body)
      }
    }, res => {
      let data = "";
      res.on("data", d => data += d);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { reject(new Error("Invalid JSON from API")); }
      });
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function runAgenticLoop(userPrompt, maxTokens) {
  const messages = [{ role: "user", content: userPrompt }];

  for (let i = 0; i < 8; i++) {
    const result = await callAnthropic(messages, maxTokens);
    if (result.status !== 200) {
      throw new Error(result.body?.error?.message || "API Error " + result.status);
    }

    const response = result.body;
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      return response;
    }

    if (response.stop_reason === "tool_use") {
      // Warte auf Web-Search Ergebnisse von Anthropic
      // Die API liefert sie automatisch im nächsten Turn
      const toolResults = (response.content || [])
        .filter(b => b.type === "tool_use")
        .map(b => ({
          type: "tool_result",
          tool_use_id: b.id,
          content: b.output || "Search results received."
        }));

      if (toolResults.length > 0) {
        messages.push({ role: "user", content: toolResults });
      }
    } else {
      return response;
    }
  }
  throw new Error("Zu viele Runden.");
}

http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Animal Knights API läuft!");
    return;
  }

  if (req.method !== "POST" || req.url !== "/api/claude") {
    res.writeHead(404); res.end("Not found"); return;
  }

  let body = "";
  req.on("data", d => body += d);
  req.on("end", async () => {
    let payload;
    try { payload = JSON.parse(body); }
    catch { res.writeHead(400); res.end(JSON.stringify({ error: "Bad JSON" })); return; }

    if (!API_KEY) {
      res.writeHead(500); res.end(JSON.stringify({ error: "API key not configured" })); return;
    }

    try {
      const userPrompt = payload.messages?.[0]?.content || "";
      const maxTokens  = payload.max_tokens || 3000;
      const response   = await runAgenticLoop(userPrompt, maxTokens);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: { message: e.message } }));
    }
  });

  req.setTimeout(110000);

}).listen(PORT, () => console.log(`Service läuft auf Port ${PORT}`));
