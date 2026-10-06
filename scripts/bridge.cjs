// Local terminal bridge: a tiny dev proxy that lets the BROWSER build of
// InfinityCoder execute REAL shell commands via fetch("/api/exec").
// Usage:  npm run bridge   (listens on http://127.0.0.1:5299)
//         vite dev proxies /api -> this server (see vite.config.ts).
const http = require("http");
const { exec } = require("child_process");
const fs = require("fs");

const PORT = Number(process.env.BRIDGE_PORT || 5299);
// Directory where agent commands actually run. Override with BRIDGE_CWD.
let CWD = process.env.BRIDGE_CWD || process.cwd();

function send(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(obj));
}

http.createServer((req, res) => {
  if (req.method === "OPTIONS") return send(res, 200, { ok: true });
  if (req.url === "/api/ping") return send(res, 200, { ok: true, cwd: CWD });

  if (req.url === "/api/exec" && req.method === "POST") {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on("end", () => {
      let cmd;
      try { cmd = JSON.parse(body); } catch { return send(res, 400, { error: "bad json" }); }
      const command = String(cmd.command ?? "").trim();
      if (!command) return send(res, 400, { error: "empty command" });
      const timeout = Math.min(Math.max(Number(cmd.timeout_s) || 120, 1), 600) * 1000;
      const isWin = process.platform === "win32";
      const child = exec(command, {
        cwd: cmd.cwd && fs.existsSync(cmd.cwd) ? cmd.cwd : CWD,
        timeout,
        maxBuffer: 8 * 1024 * 1024,
        shell: isWin ? "cmd.exe" : "/bin/sh"
      }, (err, stdout, stderr) => {
        const timedOut = err && err.killed;
        send(res, 200, {
          stdout: String(stdout).slice(0, 200000),
          stderr: String(stderr).slice(0, 100000),
          exit_code: err ? (typeof err.code === "number" ? err.code : 1) : 0,
          timed_out: !!timedOut
        });
      });
      // kill the whole tree on hard abort
      req.on("aborted", () => { try { child.kill("SIGKILL"); } catch {} });
    });
    return;
  }

  if (req.url === "/api/cwd") {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      try {
        const j = JSON.parse(body || "{}");
        if (j.cwd && fs.existsSync(j.cwd)) CWD = j.cwd;
        send(res, 200, { ok: true, cwd: CWD });
      } catch { send(res, 400, { error: "bad json" }); }
    });
    return;
  }

  send(res, 404, { error: "not found" });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`[bridge] InfinityCoder terminal bridge ready → http://127.0.0.1:${PORT}`);
  console.log(`[bridge] commands will run in: ${CWD}`);
});
