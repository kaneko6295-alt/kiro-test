import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

interface AppStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  appSecurityGroup: ec2.SecurityGroup;
  dbSecret: secretsmanager.ISecret;
  dbEndpoint: string;
  dbPort: number;
}

export class AppStack extends cdk.Stack {
  /** The ECR repository URI (used by GitHub Actions to push images) */
  public readonly ecrRepositoryUri: string;

  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);

    const { vpc, appSecurityGroup, dbSecret, dbEndpoint, dbPort } = props;

    // -----------------------------------------------------------------
    // ECR Repository
    // -----------------------------------------------------------------
    const ecrRepo = new ecr.Repository(this, "TodoEcrRepo", {
      repositoryName: "aws-todo-app",
      imageScanOnPush: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      lifecycleRules: [
        {
          description: "Keep only the last 10 images",
          maxImageCount: 10,
          rulePriority: 1,
        },
      ],
    });
    this.ecrRepositoryUri = ecrRepo.repositoryUri;

    // -----------------------------------------------------------------
    // ECS Cluster
    // Container Insights を無効化（CloudWatch Logs コスト削減）
    // -----------------------------------------------------------------
    const cluster = new ecs.Cluster(this, "TodoCluster", {
      clusterName: "todo-cluster",
      vpc,
      containerInsights: false, // コスト削減: Container Insights 無効
    });

    // -----------------------------------------------------------------
    // CloudWatch Log Group for ECS tasks
    // -----------------------------------------------------------------
    const logGroup = new logs.LogGroup(this, "TodoAppLogGroup", {
      logGroupName: "/ecs/todo-app",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // -----------------------------------------------------------------
    // Task Execution Role
    // -----------------------------------------------------------------
    const executionRole = new iam.Role(this, "EcsTaskExecutionRole", {
      roleName: "todo-ecs-task-execution-role",
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonECSTaskExecutionRolePolicy"
        ),
      ],
    });
    dbSecret.grantRead(executionRole);
    ecrRepo.grantPull(executionRole);

    // -----------------------------------------------------------------
    // Task Role
    // -----------------------------------------------------------------
    const taskRole = new iam.Role(this, "EcsTaskRole", {
      roleName: "todo-ecs-task-role",
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });
    // ECS Exec (デバッグ用) に必要な SSM 権限
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel",
        ],
        resources: ["*"],
      })
    );

    // -----------------------------------------------------------------
    // Fargate Task Definition (CPU: 256, Memory: 512 MiB)
    // -----------------------------------------------------------------
    const taskDefinition = new ecs.FargateTaskDefinition(this, "TodoTaskDef", {
      family: "todo-app",
      cpu: 256,
      memoryLimitMiB: 512,
      executionRole,
      taskRole,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    const container = taskDefinition.addContainer("TodoAppContainer", {
      image: ecs.ContainerImage.fromEcrRepository(ecrRepo, "latest"),
      containerName: "todo-app",
      portMappings: [{ containerPort: 3000, protocol: ecs.Protocol.TCP }],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "todo-app",
        logGroup,
      }),
      environment: {
        NODE_ENV: "production",
        PORT: "3000",
        // Next.js standalone server binds to process.env.HOSTNAME.
        // Docker/ECS auto-sets HOSTNAME to the container hostname, which makes
        // the server listen on that hostname instead of all interfaces and
        // breaks the localhost health check. Force it back to 0.0.0.0.
        HOSTNAME: "0.0.0.0",
      },
      secrets: {
        DB_SECRET_JSON: ecs.Secret.fromSecretsManager(dbSecret),
      },
      command: [
        "sh",
        "-c",
        [
          "export DB_USER=$(echo $DB_SECRET_JSON | node -e \"process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).username))\");",
          "export DB_PASS=$(echo $DB_SECRET_JSON | node -e \"process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).password))\");",
          `export DATABASE_URL="postgresql://$DB_USER:$DB_PASS@${dbEndpoint}:${dbPort}/tododb?schema=public";`,
          "node ./node_modules/prisma/build/index.js migrate deploy;",
          "node server.js",
        ].join(" "),
      ],
      healthCheck: {
        command: ["CMD-SHELL", "wget -qO- http://localhost:3000/api/todos || exit 1"],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(30),
      },
      essential: true,
    });
    void container;

    // -----------------------------------------------------------------
    // ECS Fargate Service
    //
    // コスト削減方針:
    //   - ALB を廃止
    //   - パブリックサブネットに配置し assignPublicIp: true
    //   - タスクに付与されるパブリック IP が直接アクセス URL になる
    //   - ポート 3000 は appSecurityGroup で制御済み
    // -----------------------------------------------------------------
    const fargateService = new ecs.FargateService(this, "TodoFargateService", {
      serviceName: "todo-app-service",
      cluster,
      taskDefinition,
      // 初回デプロイ時は ECR にイメージがないため 0 に設定
      // GitHub Actions で初回イメージ push 後に 1 以上にスケールアップする
      desiredCount: 0,
      // パブリックサブネットに配置
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [appSecurityGroup],
      // ALB なし: パブリック IP を直接割り当て
      assignPublicIp: true,
      enableExecuteCommand: true,
      // desiredCount: 0 のため Circuit Breaker は無効化
      circuitBreaker: undefined,
      deploymentController: {
        type: ecs.DeploymentControllerType.ECS,
      },
    });
    void fargateService;

    // -----------------------------------------------------------------
    // Outputs
    // -----------------------------------------------------------------
    new cdk.CfnOutput(this, "EcrRepositoryUri", {
      value: ecrRepo.repositoryUri,
      description: "ECR repository URI (used by GitHub Actions)",
      exportName: "TodoEcrRepositoryUri",
    });

    new cdk.CfnOutput(this, "EcsClusterName", {
      value: cluster.clusterName,
      description: "ECS cluster name",
      exportName: "TodoEcsClusterName",
    });

    new cdk.CfnOutput(this, "EcsServiceName", {
      value: fargateService.serviceName,
      description: "ECS service name",
      exportName: "TodoEcsServiceName",
    });

    new cdk.CfnOutput(this, "AccessNote", {
      value: [
        "ALB は使用していません。",
        "タスク起動後に以下のコマンドでパブリック IP を確認してください:",
        "aws ecs list-tasks --cluster todo-cluster --query taskArns[0] --output text",
        "| xargs -I{} aws ecs describe-tasks --cluster todo-cluster --tasks {} --query 'tasks[0].attachments[0].details[?name==`networkInterfaceId`].value' --output text",
        "| xargs -I{} aws ec2 describe-network-interfaces --network-interface-ids {} --query 'NetworkInterfaces[0].Association.PublicIp' --output text",
      ].join(" "),
      description: "How to get the ECS task public IP",
    });
  }
}
