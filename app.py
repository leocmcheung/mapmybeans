import os
import uuid
import json as _json
import urllib.request
import urllib.parse
import traceback
from datetime import datetime, date, timezone

from flask import Flask, request, jsonify, render_template, session, redirect, url_for, Response
from google.cloud import bigquery, vision, storage

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-only-change-in-prod")

APP_PASSWORD  = os.environ.get("APP_PASSWORD", "")
GCS_BUCKET    = os.environ.get("GCS_BUCKET", "")
MAPS_API_KEY  = os.environ.get("MAPS_API_KEY", "")


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


_bq_client      = None
_vision_client  = None
_storage_client = None


def bq():
    global _bq_client
    if _bq_client is None:
        _bq_client = bigquery.Client()
    return _bq_client


def table_ref():
    return f"{bq().project}.mapmybeans.beans"


def vc():
    global _vision_client
    if _vision_client is None:
        _vision_client = vision.ImageAnnotatorClient()
    return _vision_client


def gcs():
    global _storage_client
    if _storage_client is None:
        _storage_client = storage.Client()
    return _storage_client


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
        "imageUrl":         d.get("image_url"),
    }


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/beans", methods=["GET"])
def get_beans():
    rows = bq().query(f"SELECT * FROM `{table_ref()}` ORDER BY created_at DESC").result()
    return jsonify([_row_to_json(dict(r)) for r in rows])


def _date_param(name, val):
    d = _parse_date(val)
    if d is None:
        return bigquery.ScalarQueryParameter(name, "STRING", None)
    return bigquery.ScalarQueryParameter(name, "DATE", d)


@app.route("/api/beans", methods=["POST"])
def add_bean():
    data = request.get_json(force=True)
    lat = data.get("lat")
    lng = data.get("lng")

    q = f"""
    INSERT INTO `{table_ref()}`
    (id, created_at, name, roaster, roast_date, country, region, farm, lat, lng,
     taste_notes, process, variety, altitude, purchase_date, purchase_location,
     open_date, notes, coords_from_country, image_url)
    VALUES
    (@id, @created_at, @name, @roaster, CAST(@roast_date AS DATE), @country, @region, @farm,
     @lat, @lng, @taste_notes, @process, @variety, @altitude, CAST(@purchase_date AS DATE),
     @purchase_location, CAST(@open_date AS DATE), @notes, @coords_from_country, @image_url)
    """

    bean_id = data.get("id") or str(uuid.uuid4())
    params = [
        bigquery.ScalarQueryParameter("id",                "STRING",    bean_id),
        bigquery.ScalarQueryParameter("created_at",        "TIMESTAMP", datetime.now(timezone.utc)),
        bigquery.ScalarQueryParameter("name",              "STRING",    data.get("name") or ""),
        bigquery.ScalarQueryParameter("roaster",           "STRING",    data.get("roaster") or ""),
        _date_param("roast_date",                                       data.get("roastDate")),
        bigquery.ScalarQueryParameter("country",           "STRING",    data.get("country") or ""),
        bigquery.ScalarQueryParameter("region",            "STRING",    data.get("region") or ""),
        bigquery.ScalarQueryParameter("farm",              "STRING",    data.get("farm") or ""),
        bigquery.ScalarQueryParameter("lat",               "FLOAT64",   float(lat) if lat not in (None, "") else None),
        bigquery.ScalarQueryParameter("lng",               "FLOAT64",   float(lng) if lng not in (None, "") else None),
        bigquery.ScalarQueryParameter("taste_notes",       "STRING",    data.get("tasteNotes") or ""),
        bigquery.ScalarQueryParameter("process",           "STRING",    data.get("process") or ""),
        bigquery.ScalarQueryParameter("variety",           "STRING",    data.get("variety") or ""),
        bigquery.ScalarQueryParameter("altitude",          "STRING",    data.get("altitude") or ""),
        _date_param("purchase_date",                                    data.get("purchaseDate")),
        bigquery.ScalarQueryParameter("purchase_location", "STRING",    data.get("purchaseLocation") or ""),
        _date_param("open_date",                                        data.get("openDate")),
        bigquery.ScalarQueryParameter("notes",             "STRING",    data.get("notes") or ""),
        bigquery.ScalarQueryParameter("coords_from_country", "BOOL",   bool(data.get("coordsFromCountry", False))),
        bigquery.ScalarQueryParameter("image_url",         "STRING",    data.get("imageUrl") or None),
    ]

    try:
        cfg = bigquery.QueryJobConfig(query_parameters=params)
        bq().query(q, job_config=cfg).result()
    except Exception:
        msg = traceback.format_exc()
        print(msg)
        return jsonify({"error": msg}), 500

    return jsonify({"success": True, "id": bean_id}), 201


@app.route("/api/beans/<bean_id>", methods=["DELETE"])
def delete_bean(bean_id):
    q = f"DELETE FROM `{table_ref()}` WHERE id = @id"
    cfg = bigquery.QueryJobConfig(query_parameters=[
        bigquery.ScalarQueryParameter("id", "STRING", bean_id)
    ])
    bq().query(q, job_config=cfg).result()
    return jsonify({"success": True})


@app.route("/api/beans", methods=["DELETE"])
def clear_beans():
    bq().query(f"DELETE FROM `{table_ref()}` WHERE TRUE").result()
    return jsonify({"success": True})


@app.route("/api/geocode", methods=["POST"])
def geocode():
    if not MAPS_API_KEY:
        return jsonify({"error": "MAPS_API_KEY not configured on the server"}), 503

    body = request.get_json(force=True)
    parts = [body.get(k, "").strip() for k in ("farm", "region", "country")]
    query = ", ".join(p for p in parts if p)
    if not query:
        return jsonify({"error": "Provide at least a country"}), 400

    url = "https://maps.googleapis.com/maps/api/geocode/json?" + urllib.parse.urlencode({
        "address": query,
        "key": MAPS_API_KEY,
    })
    try:
        with urllib.request.urlopen(url, timeout=6) as resp:
            result = _json.loads(resp.read())
    except Exception as e:
        return jsonify({"error": f"Geocoding request failed: {e}"}), 502

    if result.get("status") != "OK" or not result.get("results"):
        status = result.get("status", "UNKNOWN")
        detail = result.get("error_message", "no details")
        return jsonify({"error": f"Geocoding API: {status} — {detail}"}), 404

    top = result["results"][0]
    loc = top["geometry"]["location"]
    return jsonify({
        "lat": loc["lat"],
        "lng": loc["lng"],
        "display_name": top.get("formatted_address", query),
    })


@app.route("/api/ocr", methods=["POST"])
def ocr():
    if "image" not in request.files:
        return jsonify({"error": "No image provided"}), 400

    f = request.files["image"]
    img_bytes = f.read()
    bean_id = request.form.get("beanId") or str(uuid.uuid4())

    # Upload to GCS and return a proxy URL
    image_url = None
    if GCS_BUCKET:
        try:
            ext = (f.filename or "").rsplit(".", 1)[-1].lower() or "jpg"
            filename = f"{bean_id}.{ext}"
            blob = gcs().bucket(GCS_BUCKET).blob(f"images/{filename}")
            blob.upload_from_string(img_bytes, content_type=f.content_type or "image/jpeg")
            image_url = f"/api/image/{filename}"
        except Exception as e:
            print(f"GCS upload failed: {e}")

    # OCR
    image = vision.Image(content=img_bytes)
    resp = vc().document_text_detection(image=image)
    if resp.error.message:
        return jsonify({"error": resp.error.message}), 500
    text = resp.full_text_annotation.text if resp.full_text_annotation else ""
    return jsonify({"text": text, "imageUrl": image_url})


@app.route("/api/image/<path:filename>")
def get_image(filename):
    if not GCS_BUCKET:
        return "", 404
    try:
        blob = gcs().bucket(GCS_BUCKET).blob(f"images/{filename}")
        img_bytes = blob.download_as_bytes()
        return Response(
            img_bytes,
            content_type=blob.content_type or "image/jpeg",
            headers={"Cache-Control": "private, max-age=86400"},
        )
    except Exception:
        return "", 404


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8080)), debug=False)
