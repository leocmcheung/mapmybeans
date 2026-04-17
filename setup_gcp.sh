#!/usr/bin/env bash
# One-time GCP infrastructure setup for mapmybeans.
# Usage: GCP_PROJECT=my-project USER_EMAIL=me@gmail.com bash setup_gcp.sh
set -euo pipefail

PROJECT_ID="${GCP_PROJECT:?Set GCP_PROJECT env var}"
USER_EMAIL="${USER_EMAIL:?Set USER_EMAIL env var}"
REGION="europe-west2"
SERVICE="mapmybeans"
REPO="mapmybeans"

echo "▶ Enabling APIs on project: $PROJECT_ID"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  bigquery.googleapis.com \
  vision.googleapis.com \
  artifactregistry.googleapis.com \
  geocoding-backend.googleapis.com \
  --project="$PROJECT_ID"

echo "▶ Creating Artifact Registry repository"
gcloud artifacts repositories create "$REPO" \
  --repository-format=docker \
  --location="$REGION" \
  --description="mapmybeans container images" \
  --project="$PROJECT_ID" 2>/dev/null || echo "  (already exists)"

echo "▶ Creating BigQuery dataset"
bq mk --dataset --location=EU \
  --description="mapmybeans coffee bean data" \
  "${PROJECT_ID}:mapmybeans" 2>/dev/null || echo "  (already exists)"

echo "▶ Creating BigQuery beans table"
bq mk --table \
  "${PROJECT_ID}:mapmybeans.beans" \
  "id:STRING,created_at:TIMESTAMP,name:STRING,roaster:STRING,roast_date:DATE,\
country:STRING,region:STRING,farm:STRING,lat:FLOAT,lng:FLOAT,taste_notes:STRING,\
process:STRING,variety:STRING,altitude:STRING,purchase_date:DATE,\
purchase_location:STRING,open_date:DATE,notes:STRING,coords_from_country:BOOL" \
  2>/dev/null || echo "  (already exists)"

echo "▶ Granting Cloud Build service account permissions"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
CB_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${CB_SA}" --role="roles/run.admin" --condition=None

gcloud iam service-accounts add-iam-policy-binding "$COMPUTE_SA" \
  --member="serviceAccount:${CB_SA}" --role="roles/iam.serviceAccountUser" \
  --project="$PROJECT_ID"

echo "▶ Granting Cloud Run service account BigQuery access"
# Vision API access is covered by the default roles/editor binding on the compute SA.
for role in roles/bigquery.dataEditor roles/bigquery.jobUser; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${COMPUTE_SA}" --role="$role" --condition=None
done

echo "▶ Creating GCS image bucket"
BUCKET="${PROJECT_ID}-mapmybeans-images"
gcloud storage buckets create "gs://${BUCKET}" \
  --location="$REGION" \
  --project="$PROJECT_ID" 2>/dev/null || echo "  (already exists)"

echo "▶ Granting Cloud Run service account GCS access"
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/storage.objectAdmin"

echo "▶ Adding image_url column to BigQuery table (safe to re-run)"
bq query --use_legacy_sql=false --project_id="$PROJECT_ID" \
  "ALTER TABLE \`${PROJECT_ID}.mapmybeans.beans\` ADD COLUMN IF NOT EXISTS image_url STRING" \
  2>/dev/null || echo "  (column may already exist)"

echo ""
echo "✅ Infrastructure ready."
echo ""
echo "Next steps:"
echo "  1. Connect this GitHub repo to Cloud Build in the GCP console"
echo "     (Cloud Build → Triggers → Connect repository → push to master)"
echo "  2. Push code — Cloud Build builds, pushes, and deploys automatically."
echo ""
echo "After first deploy, grant yourself Cloud Run invoker access:"
echo "  gcloud run services add-iam-policy-binding $SERVICE \\"
echo "    --region=$REGION \\"
echo "    --member='user:${USER_EMAIL}' \\"
echo "    --role='roles/run.invoker'"
echo ""
echo "Access the app in your browser via the gcloud proxy:"
echo "  gcloud run services proxy $SERVICE --region=$REGION"
echo "  Then open http://localhost:8080"
