"""Local HTTPS launcher.

  cd backend && python run_https.py

Reads HTTPS_ENABLED / SSL_CERT_FILE / SSL_KEY_FILE from .env.
"""
import os
import sys
import uvicorn

from app.core.config import settings

if __name__ == "__main__":
    if not settings.https_enabled:
        print("[run_https] HTTPS_ENABLED=false — falling back to plain HTTP on :8000")
        uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
        sys.exit(0)
    if not (settings.ssl_cert_file and os.path.exists(settings.ssl_cert_file)
            and settings.ssl_key_file and os.path.exists(settings.ssl_key_file)):
        print("[run_https] SSL_CERT_FILE / SSL_KEY_FILE missing — generate certs first.")
        sys.exit(1)
    uvicorn.run(
        "app.main:app", host="0.0.0.0", port=8000, reload=True,
        ssl_certfile=settings.ssl_cert_file, ssl_keyfile=settings.ssl_key_file,
    )
