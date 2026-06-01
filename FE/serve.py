"""3초 여행 — 캐시를 끄는 로컬 정적 서버.

브라우저가 이전에 본 redesign-*.js / index-redesign.html 을 메모리에 묶어두는
바람에 변경이 안 보이는 문제를 막기 위해 Cache-Control: no-store 를 강제로
모든 응답에 붙입니다.
"""
import os, sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)

class NoCacheHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js":   "application/javascript; charset=utf-8",
        ".mjs":  "application/javascript; charset=utf-8",
        ".css":  "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg":  "image/svg+xml",
        ".html": "text/html; charset=utf-8",
        "":      "application/octet-stream",
    }
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()
    def log_message(self, fmt, *args):
        # 단순 로그
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    print(f"3초 여행 (no-cache) :: http://127.0.0.1:{port}/index-redesign.html")
    print("Ctrl+C 로 종료")
    try:
        ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler).serve_forever()
    except KeyboardInterrupt:
        print("\nbye")
