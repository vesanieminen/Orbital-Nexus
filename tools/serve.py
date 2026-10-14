#!/usr/bin/env python3
"""Tiny static server with no-store caching for dev testing."""
import http.server, functools, sys

class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        super().end_headers()
    def log_message(self, *a):
        pass

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
http.server.ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
