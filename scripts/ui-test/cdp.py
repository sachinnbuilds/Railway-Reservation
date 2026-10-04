#!/usr/bin/env python3
"""Minimal CDP driver (stdlib only): log in via localStorage, visit pages, take screenshots.
usage: shot.py <token-json-file> <out-dir> <path>[@waitSeconds][!js] ...
"""
import base64, json, os, socket, struct, subprocess, sys, time, urllib.request

PORT = 9333
BASE = os.environ.get("SHOT_BASE", "http://localhost:3000")


class WS:
    def __init__(self, url):
        host_port, path = url[len("ws://"):].split("/", 1)
        host, port = host_port.split(":")
        self.s = socket.create_connection((host, int(port)))
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall((f"GET /{path} HTTP/1.1\r\nHost: {host_port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.s.recv(4096)
        self.buf = buf.split(b"\r\n\r\n", 1)[1]
        self.id = 0

    def _recv_exact(self, n):
        while len(self.buf) < n:
            chunk = self.s.recv(1 << 20)
            if not chunk:
                raise EOFError
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def recv(self):
        data = b""
        while True:
            b1, b2 = self._recv_exact(2)
            ln = b2 & 0x7F
            if ln == 126:
                ln = struct.unpack(">H", self._recv_exact(2))[0]
            elif ln == 127:
                ln = struct.unpack(">Q", self._recv_exact(8))[0]
            data += self._recv_exact(ln)
            if b1 & 0x80:
                return json.loads(data)

    def send(self, obj):
        payload = json.dumps(obj).encode()
        mask = os.urandom(4)
        hdr = bytes([0x81])
        n = len(payload)
        if n < 126:
            hdr += bytes([0x80 | n])
        elif n < 65536:
            hdr += bytes([0x80 | 126]) + struct.pack(">H", n)
        else:
            hdr += bytes([0x80 | 127]) + struct.pack(">Q", n)
        self.s.sendall(hdr + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def call(self, method, **params):
        self.id += 1
        my = self.id
        self.send({"id": my, "method": method, "params": params})
        while True:
            msg = self.recv()
            if msg.get("id") == my:
                if "error" in msg:
                    raise RuntimeError(msg["error"])
                return msg.get("result", {})


def main():
    auth_file, out_dir, *pages = sys.argv[1:]
    auth = open(auth_file).read().strip()
    prof = os.path.expanduser("~/snap/chromium/common/rrs-shot-profile")
    proc = subprocess.Popen(["chromium", "--headless=new", f"--remote-debugging-port={PORT}", f"--user-data-dir={prof}",
                             "--window-size=1366,900", "--hide-scrollbars", "--no-first-run", "about:blank"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(60):
            try:
                targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json"))
                page = next(t for t in targets if t["type"] == "page")
                break
            except Exception:
                time.sleep(0.5)
        ws = WS(page["webSocketDebuggerUrl"])
        ws.call("Page.enable")
        ws.call("Emulation.setDeviceMetricsOverride", width=1366, height=900, deviceScaleFactor=1, mobile=False)
        ws.call("Page.navigate", url=BASE + "/")
        time.sleep(2)
        ws.call("Runtime.evaluate", expression=f"localStorage.setItem('rr.auth', {json.dumps(auth)})")
        for spec in pages:
            js = None
            if "!" in spec:
                spec, js = spec.split("!", 1)
            path, wait = (spec.split("@") + ["3"])[:2]
            ws.call("Page.navigate", url=BASE + path)
            time.sleep(1.5)
            if js:
                ws.call("Runtime.evaluate", expression=js, awaitPromise=True)
            time.sleep(float(wait))
            h = ws.call("Runtime.evaluate", expression="document.documentElement.scrollHeight")["result"]["value"]
            ws.call("Emulation.setDeviceMetricsOverride", width=1366, height=min(int(h), 3000), deviceScaleFactor=1, mobile=False)
            shot = ws.call("Page.captureScreenshot", format="png")
            ws.call("Emulation.setDeviceMetricsOverride", width=1366, height=900, deviceScaleFactor=1, mobile=False)
            name = (path.strip("/").replace("/", "_") or "home") + ".png"
            open(os.path.join(out_dir, name), "wb").write(base64.b64decode(shot["data"]))
            err = ws.call("Runtime.evaluate", expression="document.body.innerText.slice(0, 300)")["result"]["value"]
            print(name, "|", err.replace("\n", " ")[:160])
    finally:
        proc.terminate()


if __name__ == "__main__":
    main()
