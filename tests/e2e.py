"""Browser checks for milestone 1, run against a local server of dist/.

Usage: python3 tests/e2e.py http://127.0.0.1:8080 [screenshot_dir]
Needs: pip install playwright && playwright install chromium
"""
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip("/")
SHOTS = sys.argv[2] if len(sys.argv) > 2 else None
failures = []


def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        failures.append(msg)


with sync_playwright() as p:
    browser = p.chromium.launch()

    # 1. Without JavaScript the 1930 button and the Help steps still work.
    ctx = browser.new_context(java_script_enabled=False)
    page = ctx.new_page()
    page.goto(f"{BASE}/help/")
    check(page.locator('a[href="tel:1930"]').count() >= 1, "no-JS: tel:1930 link present on Help")
    check(page.locator("ol.steps li").count() == 5, "no-JS: five Help steps render")
    page.goto(f"{BASE}/check/")
    check(page.locator("#ask").is_hidden(), "no-JS: 'Ask my family' stays hidden on Check")
    ctx.close()

    # 2. With JavaScript: service worker installs, CSP raises no violations, pages work offline.
    ctx = browser.new_context(viewport={"width": 360, "height": 780}, device_scale_factor=2)
    page = ctx.new_page()
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{BASE}/")
    page.evaluate("navigator.serviceWorker.ready")
    page.reload()
    check(page.evaluate("!!navigator.serviceWorker.controller"), "service worker controls the page")
    if SHOTS:
        page.screenshot(path=f"{SHOTS}/home-en.png", full_page=True)

    ctx.set_offline(True)
    for path in ["/", "/help/", "/check/", "/hi/", "/mr/help/"]:
        page.goto(f"{BASE}{path}")
        check(page.locator('a[href="tel:1930"]').count() >= 1 or path == "/terms/", f"offline: {path} opens with the 1930 button")
    ctx.set_offline(False)

    # 3. Share target: a POST to /share-target/ is answered by the worker, never the server.
    page.goto(f"{BASE}/hi/")
    page.evaluate("""() => {
        const f = document.createElement('form');
        f.method = 'POST'; f.action = '/hi/share-target/'; f.enctype = 'multipart/form-data';
        for (const [k, v] of [['text', 'Your KYC expires today. Update now: http://bit.ly/x'], ['title', 'SBI Alert']]) {
            const i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = v; f.append(i);
        }
        document.body.append(f); f.submit();
    }""")
    page.wait_for_url(f"{BASE}/hi/check/**")
    page.wait_for_function("document.getElementById('msg').value.length > 0")
    value = page.input_value("#msg")
    check("KYC expires" in value and "SBI Alert" in value, "share: text lands in the Hindi Check box")
    check(page.url == f"{BASE}/hi/check/", "share: ?shared=1 removed from the address bar")
    left = page.evaluate("caches.open('gh-share').then(c => c.match('/__shared__')).then(r => !!r)")
    check(not left, "share: shared text deleted from the cache after reading")
    check(page.locator("#ask").is_visible(), "JS: 'Ask my family' button shown")
    if SHOTS:
        page.screenshot(path=f"{SHOTS}/check-hi-shared.png", full_page=True)

    # 4. Ask my family with an empty box gives a message, not a silent failure.
    page.goto(f"{BASE}/check/")
    page.click("#ask")
    check(page.inner_text("#status").strip() != "", "Ask my family on an empty box explains what to do")

    page.goto(f"{BASE}/mr/help/")
    if SHOTS:
        page.screenshot(path=f"{SHOTS}/help-mr.png", full_page=True)
    ctx2 = browser.new_context(color_scheme="dark", viewport={"width": 360, "height": 780}, device_scale_factor=2)
    p2 = ctx2.new_page()
    p2.goto(f"{BASE}/")
    if SHOTS:
        p2.screenshot(path=f"{SHOTS}/home-en-dark.png", full_page=True)
    ctx2.close()

    csp = [e for e in errors if "Content Security Policy" in e or "Refused" in e]
    check(not csp, f"no CSP violations ({csp[:2]})")
    check(not errors, f"no console errors ({errors[:3]})")
    browser.close()

print(f"\n{len(failures)} failure(s)")
sys.exit(1 if failures else 0)
