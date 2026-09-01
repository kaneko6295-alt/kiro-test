# AWS Todo App – 学習用Webアプリ基盤

Next.js + ECS Fargate + Aurora Serverless v2 + AWS CDK + GitHub Actions で構築した AWS 学習用フルスタック Todo アプリです。

**コスト最優先構成**: NAT Gateway・ALB を廃止し、月 ~1,000 円に抑えています。

## アーキテクチャ

```
インターネット
    │
    │ HTTP :3000 (直接アクセス)
    ▼
┌─────────────────────────────────────────────┐
│ VPC (10.0.0.0/16)                           │
│                                             │
│  ┌──────────────────────────────────────┐  │
│  │ パブリックサブネット (AZ-a / AZ-c)     │  │
│  │                                      │  │
│  │  [ECS Fargate タスク]                 │  │
│  │  Next.js :3000                       │  │
│  │  パブリック IP 直接割り当て            │  │
│  │                                      │  │
│  │  [Bastion Host (t3.micro)]            │  │
│  │  SSM Session Manager 経由            │  │
│  └──────────────────────────────────────┘  │
│                 │ PostgreSQL :5432           │
│  ┌──────────────────────────────────────┐  │
│  │ Isolated サブネット (AZ-a / AZ-c)    │  │
│  │                                      │  │
│  │  [Aurora Serverless v2]              │  │
│  │  PostgreSQL 16 互換                  │  │
│  └──────────────────────────────────────┘  │
└─────────────────────────────────────────────┘

[ECR] ← GitHub Actions (OIDC) が Docker イメージをプッシュ
[CloudWatch Logs] ← ECS タスクログ (/ecs/todo-app)
[Secrets Manager] ← DB 認証情報 (todo-app/db-credentials)
```

> **注意**: ALB がないため、ECS タスクを再起動するとパブリック IP が変わります。
> 固定 URL が必要な場合は Elastic IP または Route 53 + ALB の追加を検討してください。

## 技術スタック

| レイヤー | 技術 |
|---|---|
| フロントエンド / API | Next.js 15 (App Router, TypeScript) |
| ORM | Prisma |
| コンテナ基盤 | Amazon ECS Fargate (パブリックサブネット) |
| コンテナレジストリ | Amazon ECR |
| データベース | Aurora Serverless v2 (PostgreSQL 16) |
| シークレット管理 | AWS Secrets Manager |
| IaC | AWS CDK v2 (TypeScript) |
| CI/CD | GitHub Actions (OIDC 認証) |
| 監視 | CloudWatch Logs |

## コスト見積もり（ap-northeast-1、月額）

| リソース | 旧構成 | 新構成 | 削減額 |
|---|---|---|---|
| NAT Gateway | ~$32 | $0 | **-$32** |
| ALB | ~$20 | $0 | **-$20** |
| ECS Fargate (0.25vCPU / 0.5GB × 24h) | ~$5 | ~$5 | - |
| Aurora Serverless v2 (0.5 ACU 最小) | ~$7 | ~$7 | - |
| ECR | ~$0.1 | ~$0.1 | - |
| その他 (CloudWatch 等) | ~$1 | ~$1 | - |
| **合計** | **~$65 (~¥9,500)** | **~$13 (~¥1,900)** | **-$52** |

> Aurora の料金は稼働時間に依存します。使用しない期間は `cdk destroy` で削除することでコストをゼロにできます。

---

## 前提条件

- AWS CLI v2 (設定済み)
- Node.js 22+
- Docker Desktop
- Git & GitHub アカウント

---

## セットアップ手順

### 1. リポジトリのクローン

```bash
git clone https://github.com/YOUR_USERNAME/aws-todo-app.git
cd aws-todo-app
```

### 2. アプリの依存パッケージをインストール

```bash
npm install
```

### 3. CDK の依存パッケージをインストール

```bash
cd infra
npm install
```

### 4. CDK Bootstrap（初回のみ）

```bash
npx cdk bootstrap aws://YOUR_ACCOUNT_ID/ap-northeast-1
```

### 5. GitHub リポジトリ名を設定

`infra/bin/app.ts` の以下の行を自分のリポジトリに合わせて編集します。

```typescript
const githubRepo = process.env.GITHUB_REPO ?? "YOUR_GITHUB_USERNAME/aws-todo-app";
```

### 6. インフラのデプロイ

```bash
# 変更内容を確認（ドライラン）
npx cdk diff

# 全スタックをデプロイ（順序: Network → Database → App → OIDC）
npx cdk deploy --all --require-approval never
```

デプロイ完了後、以下のような出力が表示されます：

```
TodoAppStack.EcrRepositoryUri  = 672475532453.dkr.ecr.ap-northeast-1.amazonaws.com/aws-todo-app
TodoAppStack.EcsClusterName    = todo-cluster
TodoAppStack.EcsServiceName    = todo-app-service
TodoOidcStack.DeployRoleArn    = arn:aws:iam::672475532453:role/todo-github-actions-deploy-role
```

### 7. GitHub Secret の設定

GitHub リポジトリの Settings → Secrets and variables → Actions で追加：

| Secret 名 | 値 |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | `TodoOidcStack.DeployRoleArn` の値 |

### 8. 初回 Docker イメージのプッシュ

```bash
cd ..  # リポジトリルートに戻る
bash scripts/ecr-push.sh
```

### 9. データベースマイグレーション

Bastion Host 経由で Prisma マイグレーションを実行します。

```bash
# Bastion Host の Instance ID を確認
BASTION_ID=$(aws cloudformation describe-stacks \
  --stack-name TodoDatabaseStack \
  --query "Stacks[0].Outputs[?OutputKey=='BastionInstanceId'].OutputValue" \
  --output text)

# SSM Session Manager で接続
aws ssm start-session --target "$BASTION_ID" --region ap-northeast-1
```

Bastion 上で：

```bash
# DB 接続情報を取得
SECRET=$(aws secretsmanager get-secret-value \
  --secret-id todo-app/db-credentials \
  --query SecretString --output text)

export DB_USER=$(echo $SECRET | python3 -c "import sys,json; print(json.load(sys.stdin)['username'])")
export DB_PASS=$(echo $SECRET | python3 -c "import sys,json; print(json.load(sys.stdin)['password'])")
export DB_HOST=$(echo $SECRET | python3 -c "import sys,json; print(json.load(sys.stdin)['host'])")

export DATABASE_URL="postgresql://$DB_USER:$DB_PASS@$DB_HOST:5432/tododb"

# マイグレーション実行（Node.js が必要、または psql で直接実行）
npx prisma migrate deploy
```

---

## アプリへのアクセス方法

ALB がないため、ECS タスクのパブリック IP でアクセスします。

### パブリック IP の取得

```bash
# タスク ARN を取得
TASK_ARN=$(aws ecs list-tasks \
  --cluster todo-cluster \
  --service-name todo-app-service \
  --query "taskArns[0]" \
  --output text \
  --region ap-northeast-1)

# ENI ID を取得
ENI_ID=$(aws ecs describe-tasks \
  --cluster todo-cluster \
  --tasks "$TASK_ARN" \
  --query "tasks[0].attachments[0].details[?name=='networkInterfaceId'].value" \
  --output text \
  --region ap-northeast-1)

# パブリック IP を取得
PUBLIC_IP=$(aws ec2 describe-network-interfaces \
  --network-interface-ids "$ENI_ID" \
  --query "NetworkInterfaces[0].Association.PublicIp" \
  --output text \
  --region ap-northeast-1)

echo "アクセス URL: http://$PUBLIC_IP:3000"
```

> **注意**: タスクを再起動すると IP が変わります。固定 URL が必要な場合は ALB の追加を検討してください。

---

## CI/CD パイプライン

`main` ブランチへのプッシュで自動実行されます：

```
push to main
    │
    ▼
[CI Job]
  ├── npm ci & prisma generate
  ├── tsc --noEmit (型チェック)
  ├── eslint (lint)
  └── next build
    │
    ▼ (CI 成功時のみ)
[CD Job]
  ├── OIDC で AWS 認証
  ├── ECR ログイン
  ├── docker build & push (latest + SHA タグ)
  ├── ECS タスク定義を新イメージで更新
  ├── ECS サービスをローリングデプロイ
  └── タスクのパブリック IP を表示
```

---

## 運用コマンド

### ログの確認

```bash
# ECS タスクログをリアルタイム表示
aws logs tail /ecs/todo-app --follow --region ap-northeast-1
```

### ECS Exec（コンテナにアクセス）

```bash
aws ecs execute-command \
  --cluster todo-cluster \
  --task "$TASK_ARN" \
  --container todo-app \
  --command "/bin/sh" \
  --interactive \
  --region ap-northeast-1
```

### スタックの削除（学習終了時）

```bash
cd infra
npx cdk destroy --all --force
```

> ECR の `emptyOnDelete: true` 設定により、イメージごと削除されます。

---

## ディレクトリ構成

```
aws-todo-app/
├── src/
│   ├── app/
│   │   ├── api/todos/        # API Routes (GET, POST)
│   │   │   └── [id]/         # API Routes (PATCH, DELETE)
│   │   ├── layout.tsx
│   │   ├── page.tsx          # Todo UI
│   │   └── globals.css
│   └── lib/
│       ├── prisma.ts         # Prisma client singleton
│       └── inMemoryStore.ts  # Fallback store (DB 未設定時)
├── prisma/
│   └── schema.prisma         # DB スキーマ
├── infra/
│   ├── bin/app.ts            # CDK エントリポイント（4 スタック）
│   └── lib/
│       ├── network-stack.ts  # VPC / SG（NAT GW なし）
│       ├── database-stack.ts # Aurora Serverless v2 / Bastion
│       ├── app-stack.ts      # ECR / ECS Fargate（ALB なし）
│       └── oidc-stack.ts     # GitHub Actions OIDC ロール
├── .github/workflows/
│   └── deploy.yml            # CI/CD パイプライン
├── scripts/
│   └── ecr-push.sh           # 初回 ECR プッシュスクリプト
├── Dockerfile                # マルチステージビルド
├── .dockerignore
└── README.md
```
