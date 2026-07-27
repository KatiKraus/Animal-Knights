const https = require("https");
const http  = require("http");

const API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT    = process.env.PORT || 3000;

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
  req.on("end", () => {

    let payload;
    try { payload = JSON.parse(body); }
    catch { res.writeHead(400); res.end(JSON.stringify({ error: "Bad JSON" })); return; }

    if (!API_KEY) {
      res.writeHead(500); res.end(JSON.stringify({ error: "API key not configured" })); return;
    }

    // Web Search Tool aktiviert
    const requestBody = JSON.stringify({
      model:      "claude-sonnet-4-6",
      max_tokens: payload.max_tokens || 2000,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search"
        }
      ],
      messages: payload.messages
    });

    const options = {
      hostname: "api.anthropic.com",
      path:     "/v1/messages",
      method:   "POST",
      timeout:  120000,
      headers: {
        "Content-Type":         "application/json",
        "x-api-key":            API_KEY,
        "anthropic-version":    "2023-06-01",
        "anthropic-beta":       "web-search-2025-03-05",
        "Content-Length":       Buffer.byteLength(requestBody)
      }
    };

    const apiReq = https.request(options, apiRes => {
      let result = "";
      apiRes.on("data", d => result += d);
      apiRes.on("end", () => {
        res.writeHead(apiRes.statusCode, { "Content-Type": "application/json" });
        res.end(result);
      });
    });

    apiReq.on("timeout", () => {
      apiReq.destroy();
      res.writeHead(504); res.end(JSON.stringify({ error: "Timeout – bitte nochmal versuchen" }));
    });

    apiReq.on("error", e => {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    });

    apiReq.write(requestBody);
    apiReq.end();
  });

  req.setTimeout(110000, () => {
    res.writeHead(504); res.end(JSON.stringify({ error: "Request timeout" }));
  });

}).listen(PORT, () => console.log(`Animal Knights API-Proxy läuft auf Port ${PORT}`));
