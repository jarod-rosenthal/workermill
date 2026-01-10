/**
 * QueueProvider Interface
 *
 * Abstraction for message queues (AWS SQS, RabbitMQ, Redis, etc.)
 * Implement this interface to use different queue backends.
 */

export interface QueueMessage<T = any> {
  id: string;
  body: T;
  receiptHandle: string;
  attributes?: Record<string, any>;
}

export interface QueueProviderConfig {
  url?: string;
  region?: string;
  [key: string]: any;
}

export interface QueueProvider<T = any> {
  /**
   * Initialize the queue connection
   */
  initialize(config: QueueProviderConfig): Promise<void>;

  /**
   * Send a message to the queue
   */
  sendMessage(body: T, options?: { delaySeconds?: number }): Promise<string>;

  /**
   * Receive messages from the queue
   */
  receiveMessages(options?: {
    maxMessages?: number;
    waitTimeSeconds?: number;
    visibilityTimeout?: number;
  }): Promise<QueueMessage<T>[]>;

  /**
   * Delete a message after processing
   */
  deleteMessage(receiptHandle: string): Promise<void>;

  /**
   * Change the visibility timeout of a message
   */
  changeMessageVisibility(receiptHandle: string, visibilityTimeout: number): Promise<void>;
}
