#!/bin/bash
# =============================================================
# ECR リポジトリ作成 & Docker イメージのプッシュ手順スクリプト
# 実行前に AWS CLI の認証設定が完了していること
# =============================================================

set -euo pipefail

AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION="ap-northeast-1"
ECR_REPO_NAME="aws-todo-app"
ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO_NAME}"

echo "==> AWS Account: ${AWS_ACCOUNT_ID}"
echo "==> ECR URI: ${ECR_URI}"

# 1. ECR リポジトリ作成（すでに存在する場合はスキップ）
echo ""
echo "==> [1] Creating ECR repository..."
aws ecr create-repository \
  --repository-name "${ECR_REPO_NAME}" \
  --image-scanning-configuration scanOnPush=true \
  --encryption-configuration encryptionType=AES256 \
  --region "${AWS_REGION}" 2>/dev/null || echo "Repository already exists, skipping."

# 2. ECR へログイン
echo ""
echo "==> [2] Logging in to ECR..."
aws ecr get-login-password --region "${AWS_REGION}" | \
  docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

# 3. Docker イメージをビルド
echo ""
echo "==> [3] Building Docker image..."
docker build -t "${ECR_REPO_NAME}:latest" .

# 4. タグ付け
echo ""
echo "==> [4] Tagging image..."
docker tag "${ECR_REPO_NAME}:latest" "${ECR_URI}:latest"

# 5. ECR へプッシュ
echo ""
echo "==> [5] Pushing image to ECR..."
docker push "${ECR_URI}:latest"

echo ""
echo "==> Done! Image pushed to: ${ECR_URI}:latest"
