# =============================================================================
# GPU Inference (Optional - disabled by default)
# =============================================================================
#
# Usage:
#   terraform apply -var="gpu_enabled=true"                                   # Create SG, IAM, template
#   terraform apply -var="gpu_enabled=true" -var="gpu_create_instance=true"   # Launch spot instance
#   aws ssm start-session --target <instance-id>                              # Connect
#   terraform apply -var="gpu_enabled=true" -var="gpu_create_instance=false"  # Terminate
#   terraform apply                                                           # Destroy all
#
# =============================================================================

module "gpu_inference" {
  source = "../../modules/gpu-inference"
  count  = var.gpu_enabled ? 1 : 0

  project     = "workermill"
  environment = var.environment
  region      = "us-east-1"

  vpc_id             = module.networking.vpc_id
  vpc_cidr           = module.networking.vpc_cidr
  private_subnet_ids = module.networking.private_subnet_ids

  ami_id           = "ami-0f670b5aa9dde5d62" # Deep Learning AMI Ubuntu 22.04
  instance_type    = var.gpu_instance_type
  root_volume_size = 500
  spot_max_price   = "15.00"

  user_data = <<-EOF
    #!/bin/bash
    exec > >(tee /var/log/user-data.log) 2>&1
    echo "[gpu-init] Starting GPU instance setup..."

    # Install CloudWatch agent for log streaming
    echo "[gpu-init] Installing CloudWatch agent..."
    wget -q https://s3.amazonaws.com/amazoncloudwatch-agent/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb
    dpkg -i -E ./amazon-cloudwatch-agent.deb
    rm amazon-cloudwatch-agent.deb

    # Configure CloudWatch agent
    cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json << 'CWCONFIG'
    {
      "logs": {
        "logs_collected": {
          "files": {
            "collect_list": [
              {
                "file_path": "/var/log/user-data.log",
                "log_group_name": "/workermill/gpu-inference",
                "log_stream_name": "{instance_id}/user-data",
                "timestamp_format": "%Y-%m-%d %H:%M:%S"
              },
              {
                "file_path": "/var/log/vllm.log",
                "log_group_name": "/workermill/gpu-inference",
                "log_stream_name": "{instance_id}/vllm",
                "timestamp_format": "%Y-%m-%d %H:%M:%S"
              }
            ]
          }
        }
      }
    }
    CWCONFIG

    # Start CloudWatch agent
    /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
      -a fetch-config -m ec2 -s \
      -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json

    # Install Python packages
    echo "[gpu-init] Installing Python packages..."
    pip install --upgrade pip vllm transformers huggingface_hub openai

    # Create model download script
    cat > /home/ubuntu/download-model.sh << 'SCRIPT'
    #!/bin/bash
    echo "[download] Starting Kimi K2 model download..."
    python3 -c "
    from huggingface_hub import snapshot_download
    print('[download] Downloading RedHatAI/Kimi-K2-Instruct-quantized.w4a16...')
    snapshot_download('RedHatAI/Kimi-K2-Instruct-quantized.w4a16', local_dir='/home/ubuntu/models/kimi-k2')
    print('[download] Download complete!')
    "
    SCRIPT
    chmod +x /home/ubuntu/download-model.sh

    # Create vLLM startup script (logs to file for CloudWatch)
    cat > /home/ubuntu/start-vllm.sh << 'SCRIPT'
    #!/bin/bash
    echo "[vllm] Starting vLLM server..."
    python3 -m vllm.entrypoints.openai.api_server \
      --model /home/ubuntu/models/kimi-k2 \
      --tensor-parallel-size 8 \
      --max-model-len 32768 \
      --enforce-eager \
      --host 0.0.0.0 --port 8000 \
      2>&1 | tee /var/log/vllm.log
    SCRIPT
    chmod +x /home/ubuntu/start-vllm.sh
    chown ubuntu:ubuntu /home/ubuntu/*.sh

    echo "[gpu-init] Setup complete. Run ./download-model.sh then ./start-vllm.sh"
  EOF

  create_instance = var.gpu_create_instance

  depends_on = [module.networking]
}
