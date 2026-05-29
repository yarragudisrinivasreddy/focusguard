"""
tests/test_focusguard.py — Unit tests for FocusGuard.
Run: pytest tests/ -v
"""

import base64
import json
import sys
import os
import pytest
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from exceptions import GemmaConnectionError, GemmaResponseError, InvalidImageError
from session_tracker import SessionTracker


# ─── Fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture
def app():
    from app import create_app
    application = create_app()
    application.config["TESTING"] = True
    return application


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def sample_analysis():
    return {
        "fatigue_level": "medium",
        "posture_score": 7,
        "observations": ["Slight forward lean detected", "Eyes appear mildly tired"],
        "tips": ["Adjust monitor height", "Try the 20-20-20 rule", "Hydrate"],
        "break_suggestion": "Stand up and stretch your neck for 5 minutes",
        "affirmation": "You are making great progress today!"
    }


@pytest.fixture
def valid_b64_image():
    # 1x1 white JPEG as a minimal valid base64 image
    tiny_jpeg = (
        b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00'
        b'\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t'
        b'\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a'
        b'\x1f\x1e\x1d\x1a\x1c\x1c $.\' ",#\x1c\x1c(7),01444\x1f\'9=82<.342\x1e\x1e\x1e'
        b'\x1e\x1e\x1e\x1e\x1e\x1e\x1e\x1e\x1e\x1e\x1e\x1e\x1e\xff\xc0\x00\x0b'
        b'\x08\x00\x01\x00\x01\x01\x01\x11\x00\xff\xc4\x00\x1f\x00\x00\x01\x05'
        b'\x01\x01\x01\x01\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x01\x02\x03'
        b'\x04\x05\x06\x07\x08\t\n\x0b\xff\xda\x00\x08\x01\x01\x00\x00?\x00\xfb'
        b'\xd2\x8a(\x03\xff\xd9'
    )
    return base64.b64encode(tiny_jpeg).decode()


# ─── Health endpoint ─────────────────────────────────────────────────────────

def test_health_returns_ok(client):
    res = client.get('/health')
    assert res.status_code == 200
    data = res.get_json()
    assert data['status'] == 'ok'
    assert data['privacy'] == 'local-only'


# ─── Index route ─────────────────────────────────────────────────────────────

def test_index_returns_200(client):
    res = client.get('/')
    assert res.status_code == 200


# ─── Stats endpoint ───────────────────────────────────────────────────────────

def test_stats_empty_session(client):
    client.post('/clear')
    res = client.get('/stats')
    data = res.get_json()
    assert data['total_checks'] == 0
    assert data['avg_posture_score'] is None


# ─── Clear endpoint ──────────────────────────────────────────────────────────

def test_clear_session(client):
    res = client.post('/clear')
    assert res.status_code == 200
    assert res.get_json()['success'] is True


# ─── Analyze endpoint — missing image ────────────────────────────────────────

def test_analyze_missing_image(client):
    res = client.post('/analyze', json={}, content_type='application/json')
    assert res.status_code == 400
    assert res.get_json()['success'] is False


def test_analyze_empty_body(client):
    res = client.post('/analyze', data='', content_type='application/json')
    assert res.status_code == 400


# ─── Analyze endpoint — Gemma mocked ─────────────────────────────────────────

def test_analyze_success(client, valid_b64_image, sample_analysis):
    with patch('routes.analyze_frame', return_value=sample_analysis):
        res = client.post('/analyze', json={'image': valid_b64_image})
        assert res.status_code == 200
        data = res.get_json()
        assert data['success'] is True
        assert data['analysis']['fatigue_level'] == 'medium'
        assert data['analysis']['posture_score'] == 7


def test_analyze_gemma_connection_error(client, valid_b64_image):
    with patch('routes.analyze_frame', side_effect=GemmaConnectionError("LM Studio not running")):
        res = client.post('/analyze', json={'image': valid_b64_image})
        assert res.status_code == 503
        assert res.get_json()['success'] is False


def test_analyze_gemma_response_error(client, valid_b64_image):
    with patch('routes.analyze_frame', side_effect=GemmaResponseError("Bad JSON")):
        res = client.post('/analyze', json={'image': valid_b64_image})
        assert res.status_code == 500


# ─── SessionTracker ──────────────────────────────────────────────────────────

def test_session_tracker_records_entry(sample_analysis):
    tracker = SessionTracker()
    tracker.record(sample_analysis)
    stats = tracker.get_stats()
    assert stats['total_checks'] == 1
    assert stats['avg_posture_score'] == 7.0


def test_session_tracker_fatigue_distribution(sample_analysis):
    tracker = SessionTracker()
    tracker.record(sample_analysis)  # medium
    tracker.record({**sample_analysis, 'fatigue_level': 'low', 'posture_score': 9})
    tracker.record({**sample_analysis, 'fatigue_level': 'high', 'posture_score': 3})
    stats = tracker.get_stats()
    assert stats['fatigue_distribution']['medium'] == 1
    assert stats['fatigue_distribution']['low'] == 1
    assert stats['fatigue_distribution']['high'] == 1


def test_session_tracker_clear(sample_analysis):
    tracker = SessionTracker()
    tracker.record(sample_analysis)
    tracker.clear()
    assert tracker.get_stats()['total_checks'] == 0


def test_session_tracker_avg_posture_multiple(sample_analysis):
    tracker = SessionTracker()
    tracker.record({**sample_analysis, 'posture_score': 8})
    tracker.record({**sample_analysis, 'posture_score': 6})
    stats = tracker.get_stats()
    assert stats['avg_posture_score'] == 7.0


# ─── Exceptions ──────────────────────────────────────────────────────────────

def test_custom_exceptions_are_exception_subclasses():
    assert issubclass(GemmaConnectionError, Exception)
    assert issubclass(GemmaResponseError, Exception)
    assert issubclass(InvalidImageError, Exception)
