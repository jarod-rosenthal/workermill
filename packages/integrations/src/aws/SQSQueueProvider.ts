/**
 * AWS SQS Queue Provider
 *
 * Implementation of QueueProvider interface for AWS SQS.
 */

import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
} from "@aws-sdk/client-sqs";
import type {
  QueueProvider,
  QueueMessage,
  QueueProviderConfig,
} from "@agents-oncallshift/core";

export interface SQSConfig extends QueueProviderConfig {
  url: string;
  region?: string;
}

export class SQSQueueProvider<T = any> implements QueueProvider<T> {
  private client: SQSClient;
  private queueUrl: string = "";

  constructor() {
    this.client = new SQSClient({});
  }

  async initialize(config: SQSConfig): Promise<void> {
    this.queueUrl = config.url;
    this.client = new SQSClient({
      region: config.region || "us-east-1",
    });
  }

  async sendMessage(body: T, options?: { delaySeconds?: number }): Promise<string> {
    const command = new SendMessageCommand({
      QueueUrl: this.queueUrl,
      MessageBody: JSON.stringify(body),
      DelaySeconds: options?.delaySeconds,
    });

    const response = await this.client.send(command);
    return response.MessageId || "";
  }

  async receiveMessages(options?: {
    maxMessages?: number;
    waitTimeSeconds?: number;
    visibilityTimeout?: number;
  }): Promise<QueueMessage<T>[]> {
    const command = new ReceiveMessageCommand({
      QueueUrl: this.queueUrl,
      MaxNumberOfMessages: options?.maxMessages || 1,
      WaitTimeSeconds: options?.waitTimeSeconds || 1,
      VisibilityTimeout: options?.visibilityTimeout || 3600,
    });

    const response = await this.client.send(command);

    if (!response.Messages) {
      return [];
    }

    return response.Messages.map((msg) => ({
      id: msg.MessageId || "",
      body: JSON.parse(msg.Body || "{}") as T,
      receiptHandle: msg.ReceiptHandle || "",
      attributes: msg.Attributes,
    }));
  }

  async deleteMessage(receiptHandle: string): Promise<void> {
    const command = new DeleteMessageCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: receiptHandle,
    });

    await this.client.send(command);
  }

  async changeMessageVisibility(
    receiptHandle: string,
    visibilityTimeout: number
  ): Promise<void> {
    const command = new ChangeMessageVisibilityCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: receiptHandle,
      VisibilityTimeout: visibilityTimeout,
    });

    await this.client.send(command);
  }
}
