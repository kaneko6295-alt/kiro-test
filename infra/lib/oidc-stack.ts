import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

interface OidcStackProps extends cdk.StackProps {
  /**
   * GitHub repository in the format "owner/repo"
   * e.g. "myuser/aws-todo-app"
   */
  githubRepo: string;
}

/**
 * Creates an IAM OIDC provider for GitHub Actions and a deploy role
 * that allows GitHub Actions to push to ECR and update ECS services
 * without storing long-lived AWS credentials in GitHub Secrets.
 *
 * After deploying this stack, copy the output "DeployRoleArn" and
 * save it as the GitHub Secret "AWS_DEPLOY_ROLE_ARN".
 */
export class OidcStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: OidcStackProps) {
    super(scope, id, props);

    const { githubRepo } = props;

    // -----------------------------------------------------------------
    // GitHub OIDC Provider
    // There should be only ONE per AWS account.
    // If it already exists, import it instead of creating a new one.
    // -----------------------------------------------------------------
    const githubOidcProvider = new iam.OpenIdConnectProvider(
      this,
      "GitHubOidcProvider",
      {
        url: "https://token.actions.githubusercontent.com",
        clientIds: ["sts.amazonaws.com"],
        thumbprints: [
          // GitHub Actions OIDC provider thumbprint (as of 2024)
          "6938fd4d98bab03faadb97b34396831e3780aea1",
          "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
        ],
      }
    );

    // -----------------------------------------------------------------
    // Deploy Role
    // Trusted by: GitHub Actions workflows in the specified repository
    // -----------------------------------------------------------------
    const deployRole = new iam.Role(this, "GitHubActionsDeployRole", {
      roleName: "todo-github-actions-deploy-role",
      assumedBy: new iam.WebIdentityPrincipal(
        githubOidcProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          },
          StringLike: {
            // Allow any branch/tag in the specified repo
            "token.actions.githubusercontent.com:sub": `repo:${githubRepo}:*`,
          },
        }
      ),
      description: "Role assumed by GitHub Actions to deploy the Todo app",
    });

    // ECR permissions: push images
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "ECRAuth",
        effect: iam.Effect.ALLOW,
        actions: ["ecr:GetAuthorizationToken"],
        resources: ["*"],
      })
    );

    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "ECRPush",
        effect: iam.Effect.ALLOW,
        actions: [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:CompleteLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:InitiateLayerUpload",
          "ecr:PutImage",
        ],
        resources: [
          `arn:aws:ecr:${this.region}:${this.account}:repository/aws-todo-app`,
        ],
      })
    );

    // ECS permissions: update service, describe task definitions
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "ECSUpdate",
        effect: iam.Effect.ALLOW,
        actions: [
          "ecs:DescribeServices",
          "ecs:DescribeTaskDefinition",
          "ecs:DescribeTasks",
          "ecs:ListTasks",
          "ecs:RegisterTaskDefinition",
          "ecs:UpdateService",
        ],
        resources: ["*"],
      })
    );

    // IAM PassRole – needed for ECS to pass the task execution role
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "PassExecutionRole",
        effect: iam.Effect.ALLOW,
        actions: ["iam:PassRole"],
        resources: [
          `arn:aws:iam::${this.account}:role/todo-ecs-task-execution-role`,
          `arn:aws:iam::${this.account}:role/todo-ecs-task-role`,
        ],
      })
    );

    // -----------------------------------------------------------------
    // Outputs
    // -----------------------------------------------------------------
    new cdk.CfnOutput(this, "DeployRoleArn", {
      value: deployRole.roleArn,
      description:
        "Copy this ARN and save as GitHub Secret AWS_DEPLOY_ROLE_ARN",
      exportName: "TodoGitHubActionsDeployRoleArn",
    });
  }
}
