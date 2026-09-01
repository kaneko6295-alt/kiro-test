#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { NetworkStack } from "../lib/network-stack";
import { DatabaseStack } from "../lib/database-stack";
import { AppStack } from "../lib/app-stack";
import { OidcStack } from "../lib/oidc-stack";

const app = new cdk.App();

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "ap-northeast-1",
};

// Stack 1: VPC & network (NAT GW なし、パブリック + Isolated サブネット)
const networkStack = new NetworkStack(app, "TodoNetworkStack", {
  env,
  description: "VPC, subnets, security groups for AWS Todo App (no NAT GW)",
});

// Stack 2: Aurora Serverless v2 database (Isolated サブネット)
const databaseStack = new DatabaseStack(app, "TodoDatabaseStack", {
  env,
  description: "Aurora Serverless v2 (PostgreSQL) for AWS Todo App",
  vpc: networkStack.vpc,
  dbSecurityGroup: networkStack.dbSecurityGroup,
});
databaseStack.addDependency(networkStack);

// Stack 3: ECS Fargate + ECR (ALB なし、パブリックサブネット直接公開)
const appStack = new AppStack(app, "TodoAppStack", {
  env,
  description: "ECS Fargate + ECR for AWS Todo App (no ALB)",
  vpc: networkStack.vpc,
  appSecurityGroup: networkStack.appSecurityGroup,
  dbSecret: databaseStack.dbSecret,
  dbEndpoint: databaseStack.dbEndpoint,
  dbPort: databaseStack.dbPort,
});
appStack.addDependency(databaseStack);

// Stack 4: GitHub Actions OIDC IAM role
const githubRepo =
  process.env.GITHUB_REPO ?? "YOUR_GITHUB_USERNAME/aws-todo-app";
const oidcStack = new OidcStack(app, "TodoOidcStack", {
  env,
  description: "GitHub Actions OIDC role for deploying AWS Todo App",
  githubRepo,
});
void oidcStack;

app.synth();
