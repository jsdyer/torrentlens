"""Exercise Torrent Lens at a project subpath in Chromium."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil
import tempfile
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main():
    screenshots = ROOT / "browser-checks"
    screenshots.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory() as temporary:
        shutil.copytree(ROOT / "dist", Path(temporary) / "example-tool")
        server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=temporary))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch()
                page = browser.new_page(viewport={"width": 1280, "height": 1000})
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(f"http://127.0.0.1:{server.server_port}/example-tool/")
                page.route("**/assets/tool-metrics.js", lambda route: route.fulfill(status=200, content_type="text/javascript", body=""))
                page.locator("#demo").click()
                page.wait_for_function("document.querySelector('#name').textContent === 'readme.txt'")
                assert page.locator("#size").inner_text() == "1 KiB"
                assert page.locator("#file-list tr").count() == 1
                assert "example.org" in page.locator("#trackers").inner_text()
                page.locator("#filter").fill("missing")
                assert "No matching files" in page.locator("#file-list").inner_text()
                page.locator("#filter").fill("")
                with page.expect_download() as downloaded:
                    page.locator("#download").click()
                assert downloaded.value.suggested_filename == "torrentlens-report.json"
                page.locator("#magnet").fill('magnet:?xt=urn:btih:' + 'a'*40 + '&dn=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E')
                page.locator("#inspect").click()
                page.wait_for_function("document.querySelector('#format').textContent === 'V1 magnet'")
                assert "<img" in page.locator("#name").inner_text()
                assert page.locator("img").count() == 0
                assert page.locator("#files-section").is_hidden()
                assert page.locator("#count").inner_text() == "Unknown"
                page.locator("#magnet").fill("magnet:?xt=urn:btih:bad")
                page.locator("#inspect").click()
                page.wait_for_function("document.querySelector('#status').classList.contains('error')")
                assert page.locator("#results").is_hidden()
                page.locator("#clear").click()
                assert page.locator("#magnet").input_value() == ""
                page.locator("#demo").click()
                page.wait_for_function("document.querySelector('#name').textContent === 'readme.txt' && !document.querySelector('#results').hidden")
                page.screenshot(path=str(screenshots / "desktop.png"), full_page=True)
                page.set_viewport_size({"width": 390, "height": 844})
                assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
                page.screenshot(path=str(screenshots / "mobile.png"), full_page=True)
                assert not errors, errors
                browser.close()
            print("Browser checks passed: local worker, exact demo, magnet errors, inert markup, report download and mobile layout")
        finally:
            server.shutdown()


if __name__ == "__main__":
    main()
