#!/usr/bin/env python3
"""Interactive browser test of the whole UI (26 steps): real typing and clicking via the Chrome
DevTools Protocol, failing on broken flows and reporting console errors and HTTP errors.
Needs only python3 and chromium on PATH. Run with the stack up:  python3 scripts/ui-test/ui_e2e.py
"""
import base64, json, os, shutil, subprocess, sys, time, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp import WS

PORT = 9334
BASE = "http://localhost:3000"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "screenshots")
os.makedirs(OUT, exist_ok=True)

events = []          # (kind, text)
results = []         # (step, ok, detail)


class Browser:
    def __init__(self):
        prof = os.path.expanduser("~/snap/chromium/common/rrs-e2e-profile")
        shutil.rmtree(prof, ignore_errors=True)
        self.proc = subprocess.Popen(["chromium", "--headless=new", f"--remote-debugging-port={PORT}",
                                      f"--user-data-dir={prof}", "--no-first-run", "about:blank"],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(60):
            try:
                t = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json"))
                page = next(x for x in t if x["type"] == "page")
                break
            except Exception:
                time.sleep(0.5)
        self.ws = WS(page["webSocketDebuggerUrl"])
        self._orig_call = self.ws.call
        self.ws.call = self.call
        for d in ("Page", "Runtime", "Network", "Log"):
            self.call(f"{d}.enable")
        self.viewport(1366, 900)

    def handle(self, msg):
        m, p = msg.get("method"), msg.get("params", {})
        if m == "Runtime.consoleAPICalled" and p.get("type") in ("error", "warning"):
            events.append(("console." + p["type"], " ".join(str(a.get("value", a.get("description", ""))) for a in p["args"])[:300]))
        elif m == "Runtime.exceptionThrown":
            events.append(("exception", p["exceptionDetails"].get("exception", {}).get("description", p["exceptionDetails"].get("text"))[:300]))
        elif m == "Network.responseReceived":
            r = p["response"]
            if r["status"] >= 400:
                events.append((f"http {r['status']}", r["url"].replace(BASE, "")))
        elif m == "Network.loadingFailed" and not p.get("canceled"):
            events.append(("net-fail", p.get("errorText")))
        elif m == "Page.javascriptDialogOpening":
            events.append(("dialog", p["message"]))
            self.ws.send({"id": 999999, "method": "Page.handleJavaScriptDialog", "params": {"accept": True}})

    def call(self, method, **params):
        self.ws.id += 1
        my = self.ws.id
        self.ws.send({"id": my, "method": method, "params": params})
        while True:
            msg = self.ws.recv()
            if msg.get("id") == my:
                if "error" in msg:
                    raise RuntimeError(msg["error"])
                return msg.get("result", {})
            if "method" in msg:
                self.handle(msg)

    def pump(self, seconds):
        end = time.time() + seconds
        while time.time() < end:
            self.js("1")
            time.sleep(0.2)

    def viewport(self, w, h, mobile=False):
        self.call("Emulation.setDeviceMetricsOverride", width=w, height=h, deviceScaleFactor=1, mobile=mobile)

    def js(self, expr):
        r = self.call("Runtime.evaluate", expression=expr, awaitPromise=True, returnByValue=True)
        if "exceptionDetails" in r:
            raise RuntimeError(r["exceptionDetails"].get("exception", {}).get("description", "js error"))
        return r["result"].get("value")

    def go(self, path):
        self.call("Page.navigate", url=BASE + path)
        self.pump(1.5)

    def wait(self, cond, timeout=10):
        end = time.time() + timeout
        while time.time() < end:
            try:
                if self.js(f"!!({cond})"):
                    return True
            except RuntimeError:
                pass
            time.sleep(0.25)
        return False

    def text(self):
        return self.js("document.body.innerText")

    def click_text(self, text, sel="button, a"):
        ok = self.js(f"""(() => {{ const el = [...document.querySelectorAll({json.dumps(sel)})]
            .find(e => e.innerText.trim().includes({json.dumps(text)}) && !e.disabled);
            if (!el) return false; el.scrollIntoView(); el.click(); return true; }})()""")
        if not ok:
            raise RuntimeError(f"no enabled clickable element with text {text!r}")
        self.pump(0.5)

    def type(self, selector, value):
        self.js(f"(() => {{ const e = document.querySelector({json.dumps(selector)}); e.focus(); e.select && e.select(); }})()")
        self.call("Input.insertText", text=value)

    def set_value(self, selector, value):
        """For <select>/<input type=date|range>: React-compatible value change."""
        ok = self.js(f"""(() => {{ const e = document.querySelector({json.dumps(selector)}); if (!e) return false;
            const proto = e.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
            Object.getOwnPropertyDescriptor(proto, 'value').set.call(e, {json.dumps(value)});
            e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', {{ bubbles: true }}));
            e.dispatchEvent(new Event('change', {{ bubbles: true }})); return true; }})()""")
        if not ok:
            raise RuntimeError(f"no element {selector}")

    def shot(self, name):
        h = self.js("document.documentElement.scrollHeight")
        w = self.js("window.innerWidth")
        self.viewport(w, min(int(h), 3000), mobile=w < 600)
        data = self.call("Page.captureScreenshot", format="png")["data"]
        open(os.path.join(OUT, name + ".png"), "wb").write(base64.b64decode(data))
        self.viewport(w, 900, mobile=w < 600)

    def close(self):
        self.proc.terminate()


def step(name, fn):
    before = len(events)
    try:
        detail = fn() or ""
        ok = True
    except Exception as e:
        ok, detail = False, str(e)[:300]
    new = events[before:]
    results.append((name, ok, detail, new))
    flag = "PASS" if ok else "FAIL"
    print(f"[{flag}] {name} {detail}")
    for k, v in new:
        print(f"        {k}: {v}")
    sys.stdout.flush()


def expect(cond, msg):
    if not cond:
        raise AssertionError(msg)


def main():
    b = Browser()
    email = f"e2e{int(time.time())}@test.in"
    st = {}
    try:
        # ---------- anonymous ----------
        def home():
            b.go("/")
            expect(b.wait("document.querySelectorAll('form.search-bar select option').length > 5"), "station dropdowns empty")
        step("home loads stations", home)

        def protected_redirect():
            b.go("/bookings")
            expect(b.wait("location.pathname === '/login'"), f"not redirected, at {b.js('location.pathname')}")
        step("protected page redirects to login", protected_redirect)

        def anon_search_and_book():
            b.go("/")
            b.click_text("Search trains")
            expect(b.wait("document.querySelectorAll('article.train').length > 0"), "no results")
            b.js("document.querySelector('.class-tile:not([disabled])').click()")
            expect(b.wait("document.querySelector('.modal') && document.querySelector('.modal').innerText.includes('Log in')"), "no login prompt")
            b.click_text("Log in", ".modal button")
            expect(b.wait("location.pathname === '/login'"), "dialog login button did nothing")
        step("anonymous search -> book asks to log in", anon_search_and_book)

        # ---------- auth ----------
        def register():
            b.go("/login")
            b.click_text("Create an account")
            b.type("input[autocomplete=name]", "E2E Tester")
            b.type("input[type=email]", email)
            b.type("input[type=password]", "secret123")
            b.click_text("Sign up")
            expect(b.wait("document.body.innerText.includes('Hi, E2E')"), "not logged in after sign up: " + b.text()[:200])
        step("register via form", register)

        def bad_login():
            b.click_text("Log out")
            b.go("/login")
            b.type("input[type=email]", email)
            b.type("input[type=password]", "wrongpass")
            b.click_text("Log in", "form button")
            expect(b.wait("document.querySelector('.alert.error')"), "no error shown for wrong password")
            return b.js("document.querySelector('.alert.error').innerText")
        step("wrong password shows error", bad_login)

        def login():
            b.type("input[type=password]", "secret123")
            b.click_text("Log in", "form button")
            expect(b.wait("document.body.innerText.includes('Hi, E2E')"), "login failed")
        step("login via form", login)

        # ---------- search ----------
        def search_form():
            b.go("/")
            b.wait("document.querySelectorAll('form.search-bar select option').length > 5")
            b.set_value("form.search-bar label:nth-of-type(1) select", "NDLS")
            b.set_value("form.search-bar label:nth-of-type(2) select", "MAS")
            b.click_text("⇄")
            sel = b.js("[...document.querySelectorAll('form.search-bar select')].map(s => s.value).join('>')")
            expect(sel == "MAS>NDLS", f"swap gave {sel}")
            b.click_text("⇄")
            d = b.js("document.querySelector('form.search-bar input[type=date]').min")
            b.click_text("Search trains")
            expect(b.wait("document.querySelector('.result-head h2') && document.querySelector('.result-head h2').innerText.includes('NDLS → MAS')"), "results header wrong: " + b.text()[:300])
            return b.js("document.querySelector('.result-head h2').innerText") + f" (min date {d})"
        step("search form, swap, results", search_form)

        def quick_chips():
            b.click_text("Mumbai → Delhi", ".chip")
            b.click_text("Search trains")
            expect(b.wait("document.querySelector('.result-head h2').innerText.includes('MMCT → NDLS')"), "chip did not set route")
            b.click_text("Tatkal demo train", ".chip")
            b.click_text("Search trains")
            expect(b.wait("document.body.innerText.includes('22222')"), "tatkal train not found")
        step("quick route chips", quick_chips)

        def same_station():
            b.set_value("form.search-bar label:nth-of-type(2) select", "NDLS")
            b.set_value("form.search-bar label:nth-of-type(1) select", "NDLS")
            b.click_text("Search trains")
            expect(b.wait("document.querySelector('.alert.error')"), "no error for same station")
            return b.js("document.querySelector('.alert.error').innerText")
        step("same from/to shows error", same_station)

        # ---------- book + pay ----------
        def book():
            b.set_value("form.search-bar label:nth-of-type(1) select", "NDLS")
            b.set_value("form.search-bar label:nth-of-type(2) select", "BPL")
            b.click_text("Search trains")
            b.wait("document.querySelectorAll('article.train').length > 0")
            b.js("[...document.querySelectorAll('article.train')].find(a => a.innerText.includes('12002')).querySelector('.class-tile').click()")
            expect(b.wait("document.querySelector('.modal table.pax')"), "booking dialog missing")
            b.click_text("+ Add passenger", ".modal button")
            b.type(".modal tbody tr:nth-child(2) input", "Second Person")
            b.set_value(".modal tbody tr:nth-child(2) input[type=number]", "41")
            total = b.js("document.querySelector('.modal .total').innerText")
            b.shot("02-book-dialog")
            b.click_text("Book now", ".modal button")
            expect(b.wait("location.pathname.startsWith('/booking/')", 8), "did not navigate to booking page: " + b.text()[-300:])
            st["b1"] = b.js("location.pathname")
            expect(b.wait("document.body.innerText.includes('are held for you')", 15), "never reached SEATS_HELD: " + b.text()[:400])
            b.shot("03-held")
            return total.replace("\n", " ")
        step("book 2 passengers via dialog -> seats held", book)

        def pay():
            b.click_text("Pay ₹")
            expect(b.wait("document.body.innerText.includes('Ticket confirmed')", 15), "not confirmed: " + b.text()[:500])
            b.shot("04-confirmed")
            return b.js("document.querySelector('.pnr').innerText")
        step("pay -> confirmed", pay)
        st["pnr"] = b.js("document.querySelector('.pnr') && document.querySelector('.pnr').innerText")

        def cancel():
            b.click_text("Cancel ticket")
            expect(b.wait("document.body.innerText.includes('Refund of') && document.body.innerText.includes('completed')", 20), "no refund shown: " + b.text()[:500])
            b.shot("05-cancelled")
        step("cancel ticket -> refund", cancel)

        def release():
            b.go("/")
            b.click_text("Search trains")
            b.wait("document.querySelectorAll('article.train').length > 0")
            b.js("document.querySelector('.class-tile:not([disabled])').click()")
            b.wait("document.querySelector('.modal table.pax')")
            b.click_text("Book now", ".modal button")
            expect(b.wait("document.body.innerText.includes('are held for you')", 15), "not held")
            b.click_text("Release seats")
            expect(b.wait("document.body.innerText.includes('cancelled')", 10), "release did not cancel: " + b.text()[:400])
        step("book then release seats", release)

        def trips():
            b.click_text("My trips", "nav a")
            expect(b.wait("document.querySelectorAll('.list-item').length >= 2"), "trips list: " + b.text()[:300])
            b.js("document.querySelector('.list-item').click()")
            expect(b.wait("location.pathname.startsWith('/booking/')"), "trip click did nothing")
        step("my trips list + open", trips)

        def alerts():
            b.click_text("Alerts", "nav a")
            expect(b.wait("document.querySelectorAll('.list-item').length >= 2", 10), "no alerts: " + b.text()[:300])
            return f"{b.js('document.querySelectorAll(\".list-item\").length')} alerts"
        step("alerts page", alerts)

        def pnr():
            b.click_text("PNR status", "nav a")
            b.type("input[placeholder^='10-digit']", st["pnr"] or "0000000000")
            b.click_text("Check", "form button")
            expect(b.wait("document.querySelectorAll('.card .pnr').length > 0", 8), "PNR lookup failed: " + b.text()[:300])
            return b.js("document.querySelector('.badge').innerText")
        step("PNR status lookup", pnr)

        # ---------- payment chaos through the UI ----------
        def chaos_timeout():
            b.go("/control-room")
            expect(b.wait("document.body.innerText.includes('CLOSED')", 10), "breakers not shown")
            b.click_text("Money deducted, no reply")
            b.pump(1)
            b.go("/")
            b.click_text("Search trains")
            b.wait("document.querySelectorAll('article.train').length > 0")
            b.js("document.querySelector('.class-tile:not([disabled])').click()")
            b.wait("document.querySelector('.modal table.pax')")
            b.click_text("Book now", ".modal button")
            b.wait("document.body.innerText.includes('are held for you')", 15)
            b.click_text("Pay ₹")
            expect(b.wait("document.body.innerText.includes('verifying your payment')", 10), "no PAYMENT_UNKNOWN message: " + b.text()[:400])
            b.shot("06-payment-unknown")
            ok = b.wait("document.body.innerText.includes('Ticket confirmed')", 25)
            b.go("/control-room"); b.click_text("Reset to healthy"); b.pump(1)
            expect(ok, "not reconciled")
        step("charged-but-timed-out -> verifying -> confirmed", chaos_timeout)

        def chaos_down():
            b.go("/control-room")
            b.wait("document.querySelector('.chaos input[type=checkbox]')")
            b.js("document.querySelector('.chaos input[type=checkbox]').click()")
            b.pump(1)
            b.go("/")
            b.click_text("Search trains")
            b.wait("document.querySelectorAll('article.train').length > 0")
            b.js("document.querySelector('.class-tile:not([disabled])').click()")
            b.wait("document.querySelector('.modal table.pax')")
            b.click_text("Book now", ".modal button")
            b.wait("document.body.innerText.includes('are held for you')", 15)
            try:
                b.click_text("Pay ₹")
                expect(b.wait("document.querySelector('.alert.error')", 10), "no error for gateway down")
            except Exception:
                b.go("/control-room"); b.click_text("Reset to healthy"); b.pump(1)
                raise
            msg = b.js("document.querySelector('.alert.error').innerText")
            still = b.js("document.body.innerText.includes('are held for you')")
            expect(still, "seats not shown as still held")
            b.go("/control-room")
            b.click_text("Reset to healthy")
            b.pump(1)
            return msg
        step("gateway down -> clear error, seats kept", chaos_down)

        def sliders():
            b.go("/control-room")
            b.wait("document.querySelector('.chaos input[type=range]')")
            b.set_value(".chaos label:nth-of-type(1) input[type=range]", "1500")
            b.js("document.querySelector('.chaos label:nth-of-type(1) input[type=range]').dispatchEvent(new MouseEvent('mouseup', {bubbles: true}))")
            b.pump(1)
            v = json.load(urllib.request.urlopen(urllib.request.Request("http://localhost:3000/api/admin/payment/chaos",
                headers={"Authorization": "Bearer " + json.loads(b.js("localStorage.getItem('rr.auth')"))["token"]})))
            b.click_text("Reset to healthy")
            expect(v["latencyMs"] == 1500, f"slider not saved, server has {v}")
        step("latency slider saves to server", sliders)

        def fast_reject_toggle():
            b.go("/control-room")
            b.wait("document.querySelector('.toggle') && !document.querySelector('.toggle').disabled")
            before = b.js("document.querySelector('.toggle').innerText")
            b.js("document.querySelector('.toggle').click()"); b.pump(1)
            mid = b.js("document.querySelector('.toggle').innerText")
            b.js("document.querySelector('.toggle').click()"); b.pump(1)
            after = b.js("document.querySelector('.toggle').innerText")
            expect(before != mid and before == after, f"{before}->{mid}->{after}")
            return f"{before}->{mid}->{after}"
        step("fast-reject toggle", fast_reject_toggle)

        def fire_searches():
            b.click_text("Fire 60 searches")
            expect(b.wait("document.querySelectorAll('.lb-row').length >= 1", 30), "no LB result")
            return b.js("document.querySelector('.lb').innerText").replace("\n", " ")
        step("fire 60 searches", fire_searches)

        def rate_limit_sim():
            b.set_value(".sim-controls label:nth-of-type(3) input", "1")
            b.set_value(".sim-controls label:nth-of-type(4) input", "20")
            b.click_text("Open Tatkal window")
            expect(b.wait("document.body.innerText.includes('Run consistency check') && !document.querySelector('.sim-controls button').disabled", 90), "simulator never finished")
            stats = b.js("document.querySelector('.sim-stats').innerText")
            expect("Rate limited (429 at gateway)\t0" not in stats and "Rate limited (429 at gateway)\n0" not in stats, "no 429s:\n" + stats)
            b.shot("07-ratelimit-sim")
            return stats.replace("\n", " | ")[:300]
        step("simulator 1 user x 20 -> 429s", rate_limit_sim)

        def rush_sim():
            b.go("/control-room")
            b.pump(3)
            b.click_text("Open Tatkal window")
            expect(b.wait("!document.querySelector('.sim-controls button').disabled && document.querySelector('.alert.ok, .sim-stats .alert')", 120), "rush never finished")
            b.shot("08-rush-sim")
            return b.js("document.querySelector('.sim-stats').innerText").replace("\n", " | ")[:400]
        step("simulator 120-user rush", rush_sim)

        def consistency_btn():
            b.click_text("Run consistency check")
            b.pump(2)
            expect(b.wait("document.body.innerText.includes('Consistent')"), "check not consistent: " + b.js("document.querySelector('.sim-stats').innerText"))
        step("consistency check button", consistency_btn)

        # ---------- mobile ----------
        def mobile():
            b.viewport(390, 844, mobile=True)
            b.go("/")
            b.click_text("Search trains")
            b.wait("document.querySelectorAll('article.train').length > 0")
            over = b.js("document.documentElement.scrollWidth > window.innerWidth")
            b.shot("09-mobile-search")
            b.go("/control-room"); b.pump(2)
            over2 = b.js("document.documentElement.scrollWidth > window.innerWidth")
            b.shot("10-mobile-control")
            b.viewport(1366, 900)
            expect(not over and not over2, f"horizontal overflow: search={over} control={over2}")
        step("mobile layout (390px) no horizontal scroll", mobile)

        def logout():
            b.click_text("Log out")
            expect(b.wait("document.body.innerText.includes('Log in') && !document.body.innerText.includes('Hi, E2E')"), "logout failed")
        step("logout", logout)
    finally:
        b.close()
    fails = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(fails)}/{len(results)} steps passed")


if __name__ == "__main__":
    main()
