import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

interface DatabaseStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  dbSecurityGroup: ec2.SecurityGroup;
}

export class DatabaseStack extends cdk.Stack {
  /** The Secrets Manager secret that stores DB credentials */
  public readonly dbSecret: secretsmanager.ISecret;

  /** Aurora cluster writer endpoint */
  public readonly dbEndpoint: string;

  /** Aurora PostgreSQL port */
  public readonly dbPort: number = 5432;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    const { vpc, dbSecurityGroup } = props;

    // -----------------------------------------------------------------
    // Subnet group: Aurora は Isolated サブネット（NAT なし、外部通信不要）
    // -----------------------------------------------------------------
    const dbSubnetGroup = new rds.SubnetGroup(this, "DbSubnetGroup", {
      description: "Subnet group for Aurora Serverless v2",
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
    });

    // -----------------------------------------------------------------
    // Aurora Serverless v2 cluster (PostgreSQL 16 compatible)
    // Scaling: 0.5 – 4 ACUs
    // -----------------------------------------------------------------
    const cluster = new rds.DatabaseCluster(this, "AuroraCluster", {
      clusterIdentifier: "todo-aurora-cluster",
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.of("16.8", "16"),
      }),
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: 4,
      writer: rds.ClusterInstance.serverlessV2("writer", {
        publiclyAccessible: false,
      }),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      subnetGroup: dbSubnetGroup,
      securityGroups: [dbSecurityGroup],
      defaultDatabaseName: "tododb",
      credentials: rds.Credentials.fromGeneratedSecret("tododbadmin", {
        secretName: "todo-app/db-credentials",
      }),
      backup: {
        retention: cdk.Duration.days(7),
        preferredWindow: "03:00-04:00",
      },
      preferredMaintenanceWindow: "Mon:04:00-Mon:05:00",
      storageEncrypted: true,
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.dbSecret = cluster.secret!;
    this.dbEndpoint = cluster.clusterEndpoint.hostname;
    this.dbPort = cluster.clusterEndpoint.port;

    // -----------------------------------------------------------------
    // Bastion Host (EC2 t3.micro via SSM Session Manager)
    // NAT GW 廃止後は パブリックサブネットに配置し IGW 経由で SSM 通信
    // -----------------------------------------------------------------
    const bastionSg = new ec2.SecurityGroup(this, "BastionSg", {
      vpc,
      securityGroupName: "todo-bastion-sg",
      description: "Security group for bastion host (SSM only, no SSH port)",
    });
    bastionSg.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.HTTPS,
      "Allow HTTPS outbound for SSM"
    );

    const bastion = new ec2.BastionHostLinux(this, "BastionHost", {
      vpc,
      instanceName: "todo-bastion",
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO
      ),
      // NAT なし環境: パブリックサブネットに配置
      subnetSelection: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      securityGroup: bastionSg,
    });

    // Bastion → Aurora の通信を許可
    // CfnSecurityGroupIngress を使うことでスタック間の循環参照を回避する
    // （dbSecurityGroup は NetworkStack のリソースのため、直接 addIngressRule すると
    //   NetworkStack → DatabaseStack の逆方向依存が発生して循環参照になる）
    new ec2.CfnSecurityGroupIngress(this, "BastionToDbIngress", {
      groupId: dbSecurityGroup.securityGroupId,
      ipProtocol: "tcp",
      fromPort: 5432,
      toPort: 5432,
      sourceSecurityGroupId: bastionSg.securityGroupId,
      description: "Allow PostgreSQL from bastion",
    });

    this.dbSecret.grantRead(bastion.instance.role);

    // -----------------------------------------------------------------
    // Outputs
    // -----------------------------------------------------------------
    new cdk.CfnOutput(this, "DbEndpoint", {
      value: cluster.clusterEndpoint.hostname,
      description: "Aurora cluster endpoint hostname",
      exportName: "TodoDbEndpoint",
    });

    new cdk.CfnOutput(this, "DbSecretArn", {
      value: this.dbSecret.secretArn,
      description: "ARN of the DB credentials secret in Secrets Manager",
      exportName: "TodoDbSecretArn",
    });

    new cdk.CfnOutput(this, "BastionInstanceId", {
      value: bastion.instanceId,
      description: "Bastion host instance ID (use with SSM Session Manager)",
      exportName: "TodoBastionInstanceId",
    });
  }
}
