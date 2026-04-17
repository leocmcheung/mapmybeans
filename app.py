import os
import uuid
import json as _json
import urllib.request
import urllib.parse
from datetime import datetime, date

from flask import Flask, request, jsonify, render_template, session, redirect, url_for
from google.cloud import bigquery, vision

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-only-change-in-prod")

APP_PASSWORD = os.environ.get("APP_PASSWORD", "")


@app.before_request
def require_password():
    if not APP_PASSWORD:
        return  # no password set — skip auth (local dev)
    if request.endpoint in ("login", "logout", "static"):
        return
    if not session.get("authenticated"):
        return redirect(url_for("login"))


@app.route("/login", methods=["GET", "POST"])
def login():
    error = None
    if request.method == "POST":
        if request.form.get("password") == APP_PASSWORD:
            session["authenticated"] = True
            return redirect(url_for("index"))
        error = "Wrong password."
    return render_template("login.html", error=error)


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))

PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT") or os.environ.get("GCP_PROJECT", "")
TABLE_REF = f"{PROJECT_ID}.mapmybeans.beans"

_bq_client = None
_vision_client = None


def bq():
    global _bq_client
    if _bq_client is None:
        _bq_client = bigquery.Client(project=PROJECT_ID)
    return _bq_client


def vc():
    global _vision_client
    if _vision_client is None:
        _vision_client = vision.ImageAnnotatorClient()
    return _vision_client


def _parse_date(val):
    if not val:
        return None
    try:
        return date.fromisoformat(str(val)[:10])
    except (ValueError, TypeError):
        return None


def _row_to_json(row):
    d = dict(row)
    return {
        "id":               d.get("id"),
        "createdAt":        d["created_at"].isoformat() if d.get("created_at") else None,
        "name":             d.get("name"),
        "roaster":          d.get("roaster"),
        "roastDate":        d["roast_date"].isoformat() if d.get("roast_date") else None,
        "country":          d.get("country"),
        "region":           d.get("region"),
        "farm":             d.get("farm"),
        "lat":              d.get("lat"),
        "lng":              d.get("lng"),
        "tasteNotes":       d.get("taste_notes"),
        "process":          d.get("process"),
        "variety":          d.get("variety"),
        "altitude":         d.get("altitude"),
        "purchaseDate":     d["purchase_date"].isoformat() if d.get("purchase_date") else None,
        "purchaseLocation": d.get("purchase_location"),
        "openDate":         d["open_date"].isoformat() if d.get("open_date") else None,
        "notes":            d.get("notes"),
        "coordsFromCountry": d.get("coords_from_country", False),
    }


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/beans", methods=["GET"])
def get_beans():
    rows = bq().query(f"SELECT * FROM `{TABLE_REF}` ORDER BY created_at DESC").result()
    return jsonify([_row_to_json(dict(r)) for r in rows])


@app.route("/api/beans", methods=["POST"])
def add_bean():
    data = request.get_json(force=True)
    lat = data.get("lat")
    lng = data.get("lng")

    q = f"""
    INSERT INTO `{TABLE_REF}`
    (id, created_at, name, roaster, roast_date, country, region, farm, lat, lng,
     taste_notes, process, variety, altitude, purchase_date, purchase_location,
     open_date, notes, coords_from_country)
    VALUES
    (@id, @created_at, @name, @roaster, @roast_date, @country, @region, @farm,
     @lat, @lng, @taste_notes, @process, @variety, @altitude, @purchase_date,
     @purchase_location, @open_date, @notes, @coords_from_country)
    """

    bean_id = data.get("id") or str(uuid.uuid4())
    params = [
        bigquery.ScalarQueryParameter("id",                "STRING",    bean_id),
        bigquery.ScalarQueryParameter("created_at",        "TIMESTAMP", datetime.utcnow()),
        bigquery.ScalarQueryParameter("name",              "STRING",    data.get("name") or ""),
        bigquery.ScalarQueryParameter("roaster",           "STRING",    data.get("roaster") or ""),
        bigquery.ScalarQueryParameter("roast_date",        "DATE",      _parse_date(data.get("roastDate"))),
        bigquery.ScalarQueryParameter("country",           "STRING",    data.get("country") or ""),
        bigquery.ScalarQueryParameter("region",            "STRING",    data.get("region") or ""),
        bigquery.ScalarQueryParameter("farm",              "STRING",    data.get("farm") or ""),
        bigquery.ScalarQueryParameter("lat",               "FLOAT64",   float(lat) if lat not in (None, "") else None),
        bigquery.ScalarQueryParameter("lng",               "FLOAT64",   float(lng) if lng not in (None, "") else None),
        bigquery.ScalarQueryParameter("taste_notes",       "STRING",    data.get("tasteNotes") or ""),
        bigquery.ScalarQueryParameter("process",           "STRING",    data.get("process") or ""),
        bigquery.ScalarQueryParameter("variety",           "STRING",    data.get("variety") or ""),
        bigquery.ScalarQueryParameter("altitude",          "STRING",    data.get("altitude") or ""),
        bigquery.ScalarQueryParameter("purchase_date",     "DATE",      _parse_date(data.get("purchaseDate"))),
        bigquery.ScalarQueryParameter("purchase_location", "STRING",    data.get("purchaseLocation") or ""),
        bigquery.ScalarQueryParameter("open_date",         "DATE",      _parse_date(data.get("openDate"))),
        bigquery.ScalarQueryParameter("notes",             "STRING",    data.get("notes") or ""),
        bigquery.ScalarQueryParameter("coords_from_country", "BOOL",   bool(data.get("coordsFromCountry", False))),
    ]

    cfg = bigquery.QueryJobConfig(query_parameters=params)
    bq().query(q, job_config=cfg).result()
    return jsonify({"success": True, "id": bean_id}), 201


@app.route("/api/beans/<bean_id>", methods=["DELETE"])
def delete_bean(bean_id):
    q = f"DELETE FROM `{TABLE_REF}` WHERE id = @id"
    cfg = bigquery.QueryJobConfig(query_parameters=[
        bigquery.ScalarQueryParameter("id", "STRING", bean_id)
    ])
    bq().query(q, job_config=cfg).result()
    return jsonify({"success": True})


@app.route("/api/beans", methods=["DELETE"])
def clear_beans():
    bq().query(f"DELETE FROM `{TABLE_REF}` WHERE TRUE").result()
    return jsonify({"success": True})


@app.route("/api/geocode", methods=["POST"])
def geocode():
    data = request.get_json(force=True)
    parts = [data.get(k, "").strip() for k in ("farm", "region", "country")]
    query = ", ".join(p for p in parts if p)
    if not query:
        return jsonify({"error": "Provide at least a country"}), 400

    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({
        "q": query, "format": "json", "limit": 1,
    })
    req = urllib.request.Request(url, headers={"User-Agent": "mapmybeans/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=6) as resp:
            results = _json.loads(resp.read())
    except Exception as e:
        return jsonify({"error": f"Geocoding request failed: {e}"}), 502

    if not results:
        return jsonify({"error": f"No location found for: {query}"}), 404

    return jsonify({
        "lat": float(results[0]["lat"]),
        "lng": float(results[0]["lon"]),
        "display_name": results[0]["display_name"],
    })


@app.route("/api/ocr", methods=["POST"])
def ocr():
    if "image" not in request.files:
        return jsonify({"error": "No image provided"}), 400
    img_bytes = request.files["image"].read()
    image = vision.Image(content=img_bytes)
    resp = vc().document_text_detection(image=image)
    if resp.error.message:
        return jsonify({"error": resp.error.message}), 500
    text = resp.full_text_annotation.text if resp.full_text_annotation else ""
    return jsonify({"text": text})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8080)), debug=False)
