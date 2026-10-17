"""Dependency-free local API and static server for the ViaMensa demo."""

from __future__ import annotations

import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from .network import calculate, network


ROOT = Path(__file__).resolve().parents[1]


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _json(self, value, status=200):
        payload = json.dumps(value, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/api/network":
            return self._json(network())
        if path == "/api/plan":
            return self._json(calculate(set()))
        if path.startswith("/api/"):
            return self._json({"error": "Unknown API route"}, 404)
        if path == "/":
            self.path = "/index.html"
        elif path not in {"/index.html", "/style.css", "/app.js", "/mock/index.html", "/index_lina.html"}:
            return self.send_error(404)
        return super().do_GET()

    def do_POST(self):
        if urlsplit(self.path).path != "/api/plan":
            return self._json({"error": "Unknown API route"}, 404)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 0 or length > 4096:
                raise ValueError("Request body is too large")
            body = json.loads(self.rfile.read(length))
            roads = body.get("closed", [])
            if not isinstance(roads, list) or not all(isinstance(road, str) for road in roads):
                raise ValueError("closed must be a list of corridor IDs")
            return self._json(calculate(set(roads)))
        except (ValueError, json.JSONDecodeError) as exc:
            return self._json({"error": str(exc)}, 400)


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Run the ViaMensa demo")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"ViaMensa: http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
