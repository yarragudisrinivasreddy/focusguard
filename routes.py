"""
routes.py — HTTP route handlers for FocusGuard.
Separates routing from business logic.
"""

import base64
import logging
from flask import Flask, request, jsonify, render_template
from gemma import analyze_frame
from session_tracker import tracker
from exceptions import GemmaConnectionError, GemmaResponseError, InvalidImageError

logger = logging.getLogger(__name__)

MAX_IMAGE_BYTES = 4 * 1024 * 1024  # 4MB


def _extract_image_b64(req) -> str:
    """Extract and validate base64 image from request JSON."""
    data = req.get_json(silent=True)
    if not data or "image" not in data:
        raise InvalidImageError("No image field in request body.")

    image_b64 = data["image"]

    # Strip data URL prefix if present
    if "," in image_b64:
        image_b64 = image_b64.split(",", 1)[1]

    # Validate size
    decoded_size = len(base64.b64decode(image_b64 + "=="))
    if decoded_size > MAX_IMAGE_BYTES:
        raise InvalidImageError("Image exceeds 4MB limit.")

    return image_b64


def register_routes(app: Flask) -> None:

    @app.route("/")
    def index():
        """Serve the main FocusGuard dashboard."""
        return render_template("index.html")

    @app.route("/analyze", methods=["POST"])
    def analyze():
        """
        Receive a webcam frame, run Gemma 4 analysis, store result, return insights.

        Request body: { "image": "<base64 JPEG>" }
        Response: { "success": true, "analysis": {...} }
        """
        try:
            image_b64 = _extract_image_b64(request)
            analysis = analyze_frame(image_b64)
            tracker.record(analysis)
            return jsonify({"success": True, "analysis": analysis})

        except InvalidImageError as exc:
            logger.warning("Invalid image: %s", exc)
            return jsonify({"success": False, "error": str(exc)}), 400

        except GemmaConnectionError as exc:
            logger.error("Gemma connection error: %s", exc)
            return jsonify({"success": False, "error": str(exc)}), 503

        except GemmaResponseError as exc:
            logger.error("Gemma parse error: %s", exc)
            return jsonify({"success": False, "error": "Could not parse AI response."}), 500

        except Exception as exc:
            logger.exception("Unexpected error in /analyze: %s", exc)
            return jsonify({"success": False, "error": "Internal server error."}), 500

    @app.route("/stats", methods=["GET"])
    def stats():
        """Return session statistics for the dashboard."""
        return jsonify(tracker.get_stats())

    @app.route("/clear", methods=["POST"])
    def clear_session():
        """Reset the current session tracker."""
        tracker.clear()
        return jsonify({"success": True, "message": "Session cleared."})

    @app.route("/health", methods=["GET"])
    def health():
        """Health check endpoint."""
        return jsonify({"status": "ok", "app": "FocusGuard", "privacy": "local-only"})
