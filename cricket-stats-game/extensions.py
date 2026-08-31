"""
extensions.py

Holds the single Flask app instance and the single DuckDB connection, so
both app.py (the original HTML pages) and api.py (the new JSON API) can
share them without opening a second 1.6 GB database connection and without
app.py and api.py importing each other in a circle.

Also registers a pair of app-wide error handlers that keep JSON requests
JSON: any unhandled exception or 404 under /api/ gets a structured JSON
body instead of Flask's default HTML error page. The existing HTML routes
under app.py are untouched -- they still get Flask's normal error pages.
"""

import logging

import duckdb
from flask import Flask, jsonify, request

import question_gen

app = Flask(__name__)
app.secret_key = "cricket-stats-game-local-only"  # local single-device app, not internet-facing

DB_PATH = question_gen.DB_PATH
con = duckdb.connect(DB_PATH, read_only=True)

log = logging.getLogger("cricket_api")


@app.errorhandler(404)
def _handle_404(err):
    if request.path.startswith("/api/"):
        return jsonify({"error": {"code": "NOT_FOUND", "message": "No such API endpoint."}}), 404
    return err


@app.errorhandler(500)
def _handle_500(err):
    if request.path.startswith("/api/"):
        log.exception("Unhandled error on %s", request.path)
        return jsonify({
            "error": {
                "code": "SERVER_ERROR",
                "message": "Something went wrong talking to the database. Try again.",
            }
        }), 500
    return err
