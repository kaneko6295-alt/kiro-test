import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

export class NetworkStack extends cdk.Stack {
  /** The VPC shared across all stacks */
  public readonly vpc: ec2.Vpc;

  /** Security group for ECS Fargate tasks (directly internet-facing, no ALB) */
  public readonly appSecurityGroup: ec2.SecurityGroup;

  /** Security group for Aurora Serverless v2 (data layer) */
  public readonly dbSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // -----------------------------------------------------------------
    // VPC: パブリックサブネットのみ、NAT Gateway なし
    //
    // コスト削減方針:
    //   - NAT Gateway ($32/月) を廃止
    //   - ECS Fargate をパブリックサブネットに配置し assignPublicIp:true で
    //     ECR/Secrets Manager への通信を IGW 経由で行う
    //   - Aurora はプライベートサブネットに残し VPC 内通信のみ許可
    // -----------------------------------------------------------------
    this.vpc = new ec2.Vpc(this, "TodoVpc", {
      vpcName: "todo-vpc",
      availabilityZones: ["ap-northeast-1a", "ap-northeast-1c"], // AZ lookup を回避（ec2:DescribeAvailabilityZones 不要）
      natGateways: 0, // NAT GW なし – コスト削減
      ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "Isolated", // NAT なし、VPC 内通信のみ (Aurora 用)
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // -----------------------------------------------------------------
    // Security Groups
    // -----------------------------------------------------------------

    // App (ECS Fargate): インターネットから port 3000 を直接受け付ける
    // ALB がないため ECS タスクが直接公開エンドポイントになる
    this.appSecurityGroup = new ec2.SecurityGroup(this, "AppSg", {
      vpc: this.vpc,
      securityGroupName: "todo-app-sg",
      description: "Allow HTTP:3000 inbound from internet to ECS Fargate tasks",
    });
    this.appSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(3000),
      "Allow HTTP:3000 from internet (no ALB)"
    );

    // DB (Aurora): ECS アプリからの PostgreSQL 通信のみ許可
    this.dbSecurityGroup = new ec2.SecurityGroup(this, "DbSg", {
      vpc: this.vpc,
      securityGroupName: "todo-db-sg",
      description: "Allow PostgreSQL inbound from ECS Fargate only",
    });
    this.dbSecurityGroup.addIngressRule(
      this.appSecurityGroup,
      ec2.Port.tcp(5432),
      "Allow PostgreSQL from ECS app"
    );

    // -----------------------------------------------------------------
    // Outputs
    // -----------------------------------------------------------------
    new cdk.CfnOutput(this, "VpcId", {
      value: this.vpc.vpcId,
      description: "VPC ID",
      exportName: "TodoVpcId",
    });
  }
}
