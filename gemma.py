"""
gemma.py — Gemma 4 e4b integration via LM Studio's OpenAI-compatible local API.
All inference is local. No external API calls.
"""

import base64
import logging
import requests
from exceptions import GemmaConnectionError, GemmaResponseError

logger = logging.getLogger(__name__)

LMSTUDIO_URL = "http://localhost:1234/v1/chat/completions"
MODEL_NAME = "google/gemma-4-e4b"

SYSTEM_PROMPT = """You are FocusGuard, a compassionate and privacy-first mental wellness 
assistant. You analyze images of a person at their computer to assess signs of 
eye strain, fatigue, stress, or poor posture — purely to help them take better 
care of themselves.

Your role:
- Be warm, supportive, non-judgmental
- Identify visible signs: eye redness, slouched posture, tense shoulders, tired expression
- Give 2-3 specific, actionable wellness tips based on what you see
- Suggest a break activity if fatigue is detected
- Always end with one positive affirmation

Output format (JSON):
{
  "fatigue_level": "low|medium|high",
  "posture_score": 1-10,
  "observations": ["observation 1", "observation 2"],
  "tips": ["tip 1", "tip 2", "tip 3"],
  "break_suggestion": "specific 5-min activity",
  "affirmation": "one positive message"
}

IMPORTANT: This runs 100% locally. No data is shared anywhere. Respond only with valid JSON."""


def analyze_frame(image_b64: str) -> dict:
    """
    Send a base64-encoded webcam frame to Gemma 4 for mental wellness analysis.

    Args:
        image_b64: Base64-encoded JPEG image string.

    Returns:
        Parsed dict with fatigue_level, posture_score, tips, etc.

    Raises:
        GemmaConnectionError: If LM Studio is not running.
        GemmaResponseError: If the response cannot be parsed.
    """
    payload = {
        "model": MODEL_NAME,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{image_b64}"
                        }
                    },
                    {
                        "type": "text",
                        "text": "Please analyze this person's wellness state and return your assessment as JSON."
                    }
                ]
            }
        ],
        "temperature": 0.4,
        "max_tokens": 2048
    }

    try:
        response = requests.post(LMSTUDIO_URL, json=payload, timeout=30)
        response.raise_for_status()
    except requests.exceptions.ConnectionError as exc:
        logger.error("Cannot connect to LM Studio at %s", LMSTUDIO_URL)
        raise GemmaConnectionError(
            "LM Studio is not running. Please start it with Gemma 4 e4b loaded."
        ) from exc
    except requests.exceptions.RequestException as exc:
        logger.error("LM Studio request failed: %s", exc)
        raise GemmaConnectionError(f"Request failed: {exc}") from exc

    raw = response.json()

    try:
        content = raw["choices"][0]["message"]["content"].strip()
        # Strip markdown code fences if present
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]

        import json
        result = json.loads(content)
        logger.info("Gemma analysis complete — fatigue: %s", result.get("fatigue_level"))
        return result
    except (KeyError, ValueError, IndexError) as exc:
        logger.error("Failed to parse Gemma response: %s", raw)
        raise GemmaResponseError(f"Could not parse Gemma response: {exc}") from exc
