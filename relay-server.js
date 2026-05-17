const http = require("http");
const { URL } = require("url");
const WebSocket = require("ws");

const port = Number(process.env.PORT || process.env.CODEX_REMOTE_RELAY_PORT || 8788);
const relayToken = process.env.CODEX_REMOTE_RELAY_TOKEN || "dev-relay-token";

let bridgeSocket = null;
let bridgeOnline = false;
let requestId = 1;
const pending = new Map();
const appClients = new Set();
const eventHistory = [];
let lastSessions = [{
  id: "codex-app-server",
  title: "\u771f\u5b9e Codex App Server",
  status: "offline",
  summary: "PC Bridge \u672a\u8fde\u63a5 Relay",
  adapter: "relay",
}];

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", chunk => {
      body += chunk;
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function checkHttpToken(req) {
  const header = req.headers.authorization || "";
  const query = new URL(req.url, `http://${req.headers.host}`).searchParams.get("token");
  if (!relayToken) return true;
  return header === `Bearer ${relayToken}` || query === relayToken;
}

function broadcastToApps(event) {
  const stored = { ...event, ts: new Date().toISOString() };
  eventHistory.push(stored);
  if (eventHistory.length > 500) eventHistory.shift();
  if (event.type === "session.updated") {
    lastSessions = lastSessions.map(session => ({
      ...session,
      status: event.status || session.status,
      summary: event.summary || session.summary,
    }));
  }
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of appClients) {
    client.write(payload);
  }
}

function bridgeRequest(method, path, body, timeoutMs = 60000) {
  if (!bridgeSocket || bridgeSocket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("PC Bridge is not connected to Relay"));
  }
  const id = requestId++;
  bridgeSocket.send(JSON.stringify({ type: "request", id, method, path, body }));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout waiting for bridge ${method} ${path}`));
      }
    }, timeoutMs);
    pending.set(id, { resolve, reject, timeout });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    });
    res.end();
    return;
  }

  try {
    if (!checkHttpToken(req)) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        name: "Codex Remote Relay",
        version: "0.1.0",
        bridgeOnline,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/sessions") {
      if (!bridgeOnline) {
        sendJson(res, 200, lastSessions);
        return;
      }
      const response = await bridgeRequest("GET", "/sessions", null);
      lastSessions = response.payload;
      sendJson(res, response.statusCode || 200, response.payload);
      return;
    }

    if (req.method === "GET" && url.pathname === "/codex/projects") {
      const response = await bridgeRequest("GET", "/codex/projects", null);
      sendJson(res, response.statusCode || 200, response.payload);
      return;
    }

    if (req.method === "GET" && url.pathname === "/codex/conversations") {
      const response = await bridgeRequest("GET", "/codex/conversations", {
        projectId: url.searchParams.get("projectId") || "",
      });
      sendJson(res, response.statusCode || 200, response.payload);
      return;
    }

    if (req.method === "GET" && url.pathname === "/codex/project") {
      const response = await bridgeRequest("GET", "/codex/project", {
        projectId: url.searchParams.get("projectId") || "",
      });
      sendJson(res, response.statusCode || 200, response.payload);
      return;
    }

    if (req.method === "GET" && url.pathname === "/codex/history") {
      const response = await bridgeRequest("GET", "/codex/history", {
        conversationId: url.searchParams.get("conversationId") || "",
        limit: url.searchParams.get("limit") || "20",
      });
      sendJson(res, response.statusCode || 200, response.payload);
      return;
    }

    if (req.method === "GET" && url.pathname === "/codex/statuses") {
      const response = await bridgeRequest("GET", "/codex/statuses", null);
      sendJson(res, response.statusCode || 200, response.payload);
      return;
    }

    if (req.method === "GET" && url.pathname === "/desktop-ui/status") {
      const response = await bridgeRequest("GET", "/desktop-ui/status", {
        conversationId: url.searchParams.get("conversationId") || "",
      });
      sendJson(res, response.statusCode || 200, response.payload);
      return;
    }

    if (req.method === "GET" && url.pathname === "/events/history") {
      sendJson(res, 200, eventHistory);
      return;
    }

    if (req.method === "GET" && url.pathname === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      res.write(`data: ${JSON.stringify({
        type: "message",
        text: bridgeOnline
          ? "Relay \u5df2\u8fde\u63a5 PC Bridge\uff0c\u79fb\u52a8\u7f51\u7edc\u53ef\u7528\u3002"
          : "Relay \u5df2\u8fde\u63a5\uff0c\u4f46 PC Bridge \u6682\u672a\u4e0a\u7ebf\u3002",
      })}\n\n`);
      appClients.add(res);
      req.on("close", () => appClients.delete(res));
      return;
    }

    if (req.method === "POST" && url.pathname === "/messages") {
      const body = await readBody(req);
      const response = await bridgeRequest("POST", "/messages", body);
      sendJson(res, response.statusCode || 202, response.payload);
      return;
    }

    if (req.method === "POST" && url.pathname === "/desktop-ui/open") {
      const body = await readBody(req);
      const response = await bridgeRequest("POST", "/desktop-ui/open", body);
      sendJson(res, response.statusCode || 202, response.payload);
      return;
    }

    if (req.method === "POST" && url.pathname === "/attachments") {
      const body = await readBody(req);
      const response = await bridgeRequest("POST", "/attachments", body, 180000);
      sendJson(res, response.statusCode || 201, response.payload);
      return;
    }

    if (req.method === "POST" && url.pathname === "/codex/status/ack") {
      const body = await readBody(req);
      const response = await bridgeRequest("POST", "/codex/status/ack", body);
      sendJson(res, response.statusCode || 202, response.payload);
      return;
    }

    if (req.method === "POST" && url.pathname === "/confirmations") {
      const body = await readBody(req);
      const response = await bridgeRequest("POST", "/confirmations", body);
      sendJson(res, response.statusCode || 202, response.payload);
      return;
    }

    sendJson(res, 404, { error: "not found" });
  } catch (error) {
    sendJson(res, 502, { error: error.message });
  }
});

const wss = new WebSocket.Server({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== "/bridge" || url.searchParams.get("token") !== relayToken) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, ws => {
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", ws => {
  if (bridgeSocket && bridgeSocket.readyState === WebSocket.OPEN) {
    bridgeSocket.close(4000, "replaced by a new bridge");
  }
  bridgeSocket = ws;
  bridgeOnline = true;
  broadcastToApps({
    type: "session.updated",
    status: "idle",
    summary: "PC Bridge \u5df2\u8fde\u63a5 Relay",
  });

  ws.on("message", data => {
    let message;
    try {
      message = JSON.parse(data.toString("utf8"));
    } catch {
      return;
    }
    if (message.type === "event") {
      broadcastToApps(message.event || {});
      return;
    }
    if (message.type === "response" && pending.has(message.id)) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(waiter.timeout);
      waiter.resolve(message);
    }
  });

  ws.on("close", () => {
    if (bridgeSocket === ws) {
      bridgeSocket = null;
      bridgeOnline = false;
      broadcastToApps({
        type: "session.updated",
        status: "offline",
        summary: "PC Bridge \u5df2\u4e0e Relay \u65ad\u5f00",
      });
    }
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Codex Remote Relay listening on http://127.0.0.1:${port}`);
  console.log(`Bridge websocket: ws://127.0.0.1:${port}/bridge?token=${relayToken}`);
});
