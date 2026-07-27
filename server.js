const https = require("https");
const http  = require("http");

const API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT    = process.env.PORT || 3000;

// Anthropic API Aufruf als Promise
function callAnthropic(messages, maxTokens, useWebSearch) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:      "claude-sonnet-4-6",
      max_tokens: maxTokens,
      tools: useWebSearch ? [{ type: "web_search_20250305", name: "web_search" }] : [],
      messages:   messages
    });

    const headers = {
      "Content-Type":      "application/json",
      "x-api-key":         API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Length":    Buffer.byteLength(body)
    };
    if (useWebSearch) headers["anthropic-beta"] = "web-search-2025-03-05";

    const req = https.request({
      hostname: "api.anthropic.com",
      path:     "/v1/messages",
      method:   "POST",
      timeout:  120000,
      headers
    }, res => {
      let data = "";
      res.on("data", d => data += d);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { reject(new Error("Invalid JSON from API")); }
      });
    });

    req.on("timeout", () => { req.destroy(); reject(new Error("API timeout")); });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// Agentic loop: Web-Search Runden durchführen bis finale Textantwort
async function runWithWebSearch(userPrompt, maxTokens) {
  const messages = [{ role: "user", content: userPrompt }];
  let rounds = 0;

  while (rounds < 5) {
    rounds++;
    const result = await callAnthropic(messages, maxTokens, true);

    if (result.status !== 200) {
      throw new Error(result.body?.error?.message || "API Error " + result.status);
    }

    const response = result.body;
    const stopReason = response.stop_reason;

    // Antwort zu messages hinzufügen
    messages.push({ role: "assistant", content: response.content });

    if (stopReason === "end_turn") {
      // Fertig – gib die komplette Response zurück
      return response;
    }

    if (stopReason === "tool_use") {
      // Web-Search Results verarbeiten
      const toolResults = [];
      for (const block of response.content) {
        if (block.type === "tool_use" && block.name === "web_search") {
          // Tool-Result hinzufügen (Render führt keine echte Suche durch,
          // aber Claude verwaltet das selbst über die API)
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: "Search completed by Anthropic web search."
          });
        }
      }
      if (toolResults.length > 0) {
        messages.push({ role: "user", content: toolResults });
      }
    } else {
      // Anderer stop_reason – trotzdem zurückgeben
      return response;
    }
  }

  throw new Error("Zu viele Suchrunden – bitte nochmal versuchen.");
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
      const maxTokens  = payload.max_tokens || 2000;

      const response = await runWithWebSearch(userPrompt, maxTokens);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));

    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: { message: e.message } }));
    }
  });

  req.setTimeout(110000, () => {
    res.writeHead(504); res.end(JSON.stringify({ error: "Request timeout" }));
  });

}).listen(PORT, () => console.log(`Animal Knights API-Proxy läuft auf Port ${PORT}`));
