"""
FocusGuard - Local Mental Health & Screen Fatigue Monitor
Privacy-first: All processing done locally via Gemma 4 on LM Studio.
No data leaves your machine.
"""

import logging
from flask import Flask
from flask_cors import CORS
from routes import register_routes

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

def create_app() -> Flask:
    app = Flask(__name__)
    app.config["SECRET_KEY"] = "focusguard-local-only"
    app.config["MAX_CONTENT_LENGTH"] = 5 * 1024 * 1024  # 5MB max upload
    
    # Enable CORS for Chrome Extension context
    CORS(app, resources={r"/*": {"origins": ["chrome-extension://*", "http://localhost:*", "http://127.0.0.1:*"]}})
    
    register_routes(app)
    logger.info("FocusGuard started — all data stays local.")
    return app


if __name__ == "__main__":
    app = create_app()
    app.run(debug=True, port=5000)
