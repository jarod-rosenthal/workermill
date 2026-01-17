# GPU Inference Module
# Deploys a GPU spot instance for LLM inference using existing private subnets

locals {
  name_prefix = "${var.project}-${var.environment}"
}

# -----------------------------------------------------------------------------
# Security Group (internal only)
# -----------------------------------------------------------------------------
resource "aws_security_group" "gpu" {
  name        = "${local.name_prefix}-gpu-inference"
  description = "Security group for GPU inference instances"
  vpc_id      = var.vpc_id

  # Allow vLLM API from within VPC only
  ingress {
    description = "vLLM API from VPC"
    from_port   = 8000
    to_port     = 8000
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  # Allow all outbound (for model downloads via NAT)
  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.name_prefix}-gpu-inference"
  }
}

# -----------------------------------------------------------------------------
# IAM Role for SSM Session Manager
# -----------------------------------------------------------------------------
resource "aws_iam_role" "gpu" {
  name = "${local.name_prefix}-gpu-inference"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name = "${local.name_prefix}-gpu-inference"
  }
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.gpu.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# CloudWatch Logs policy for CloudWatch agent
resource "aws_iam_role_policy" "cloudwatch_logs" {
  name = "${local.name_prefix}-gpu-cloudwatch-logs"
  role = aws_iam_role.gpu.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams"
        ]
        Resource = [
          "arn:aws:logs:*:*:log-group:/workermill/gpu-inference*"
        ]
      }
    ]
  })
}

resource "aws_iam_instance_profile" "gpu" {
  name = "${local.name_prefix}-gpu-inference"
  role = aws_iam_role.gpu.name
}

# -----------------------------------------------------------------------------
# Launch Template
# -----------------------------------------------------------------------------
resource "aws_launch_template" "gpu" {
  name = "${local.name_prefix}-gpu-inference"

  image_id      = var.ami_id
  instance_type = var.instance_type

  iam_instance_profile {
    arn = aws_iam_instance_profile.gpu.arn
  }

  vpc_security_group_ids = [aws_security_group.gpu.id]

  block_device_mappings {
    device_name = "/dev/sda1"
    ebs {
      volume_size           = var.root_volume_size
      volume_type           = "gp3"
      delete_on_termination = true
      encrypted             = true
    }
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  user_data = base64encode(var.user_data)

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name = "${local.name_prefix}-gpu-inference"
    }
  }

  tags = {
    Name = "${local.name_prefix}-gpu-inference"
  }
}

# -----------------------------------------------------------------------------
# Spot Fleet Request (uses existing private subnets)
# -----------------------------------------------------------------------------
resource "aws_iam_role" "spot_fleet" {
  count = var.create_instance ? 1 : 0
  name  = "${local.name_prefix}-gpu-spot-fleet"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "spotfleet.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "spot_fleet" {
  count      = var.create_instance ? 1 : 0
  role       = aws_iam_role.spot_fleet[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEC2SpotFleetTaggingRole"
}

resource "aws_spot_fleet_request" "gpu" {
  count = var.create_instance ? 1 : 0

  iam_fleet_role                      = aws_iam_role.spot_fleet[0].arn
  target_capacity                     = 1
  terminate_instances_with_expiration = true
  wait_for_fulfillment                = true

  allocation_strategy = "lowestPrice"
  spot_price          = var.spot_max_price

  # Launch spec for each existing private subnet
  dynamic "launch_specification" {
    for_each = var.private_subnet_ids
    content {
      instance_type          = var.instance_type
      ami                    = var.ami_id
      subnet_id              = launch_specification.value
      vpc_security_group_ids = [aws_security_group.gpu.id]
      iam_instance_profile   = aws_iam_instance_profile.gpu.name

      root_block_device {
        volume_size           = var.root_volume_size
        volume_type           = "gp3"
        delete_on_termination = true
        encrypted             = true
      }

      user_data = base64encode(var.user_data)

      tags = {
        Name = "${local.name_prefix}-gpu-inference"
      }
    }
  }

  tags = {
    Name = "${local.name_prefix}-gpu-spot-fleet"
  }

  depends_on = [aws_iam_role_policy_attachment.spot_fleet]
}

# Get the instance ID from the spot fleet
data "aws_instances" "gpu" {
  count = var.create_instance ? 1 : 0

  filter {
    name   = "tag:Name"
    values = ["${local.name_prefix}-gpu-inference"]
  }

  filter {
    name   = "instance-state-name"
    values = ["running", "pending"]
  }

  depends_on = [aws_spot_fleet_request.gpu]
}
