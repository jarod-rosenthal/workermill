terraform {
  backend "s3" {
    # Bucket name passed via -backend-config during init
    # terraform init -backend-config="bucket=workermill-terraform-state-ACCOUNT_ID"
    key            = "workermill/dev/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "workermill-terraform-locks"
    encrypt        = true
  }
}
